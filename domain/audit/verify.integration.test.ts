import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPayload, type Payload } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '../../payload.config'
import { withTransaction } from '../with-transaction'
import { addAuditEvent, type AuditEventInput } from './builder'
import { parseAuditEnvelope } from './envelope'
import { getAuditKeys } from './runtime-keys'
import { verifyAuditChains, type AuditChainReport } from './verify'
import { auditTestOrganizationId, prepareAuditTestData } from '@/testing/audit-test-data'

// Verificador (F1b, paso 6) contra PostgreSQL real, leyendo por el mismo camino que
// `pnpm audit:verify`: ida y vuelta (escribir, leer por SQL, recalcular, comparar) con fechas,
// números en jsonb, Unicode y office_ids; `numeric` que node-postgres devuelve como texto (Tani);
// lectura por lotes; y alteraciones: payload cambiado, hueco, orden cambiado, evento insertado con
// un hash inventado, sequence no entera, clave ausente y contexto de red faltante o alterado.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OFFICES = [
  '00000000-0000-4000-8000-00000000000c',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
]
const MARKER = 'contenido-del-payload-que-nunca-se-imprime'
const IP = '203.0.113.42'

let cached: Payload | undefined
const payloadFor = async () => (cached ??= await getPayload({ config }))
const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle
const db = async () => drizzle(await payloadFor())

function event(org: string, index: number): AuditEventInput {
  return {
    action: 'scan.rename',
    scope: { kind: 'organization', organizationId: org, officeIds: OFFICES },
    entity: { type: 'scan_report', id: `report-${index}` },
    actor: { type: 'user', id: '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170', role: 'org_admin' },
    origin: 'interactive',
    payload: {
      marker: MARKER,
      index,
      // Números que jsonb guarda como numeric y node-postgres devuelve con JSON.parse.
      numbers: [
        0.1, 0.30000000000000004, 1e-7, 1e21, -0, 9007199254740991, -12.5, 1.7976931348623157e308,
        5e-324,
      ],
      text: 'Ñandú 🦜 "comillas" \\ barra \t tab',
      nested: { z: 1, a: [{ b: null }, [], {}], 'clave con espacios': true },
      empty: '',
    },
    network:
      index % 2 === 0
        ? { source: 'trusted_proxy', ip: IP, family: 'ipv4', captured_at: new Date().toISOString() }
        : { source: 'unknown', ip: null, family: null, captured_at: new Date().toISOString() },
  }
}

/** Una cadena de prueba con `count` eventos, uno por transacción. Devuelve su chain_id. */
async function writeChain(count: number): Promise<string> {
  const org = auditTestOrganizationId()
  const payload = await payloadFor()
  for (let index = 1; index <= count; index++)
    await withTransaction(payload, undefined, req => addAuditEvent(req, event(org, index)))
  return `org:${org}`
}

async function verify(chainId: string, options: Parameters<typeof verifyAuditChains>[1] = {}) {
  const report = await verifyAuditChains(await payloadFor(), {
    chainIds: [chainId],
    batchSize: 2,
    ...options,
  })
  assert.equal(report.chains.length, 1)
  return { report, chain: report.chains[0]! }
}

function assertError(chain: AuditChainReport, kind: string, sequence: number) {
  assert.ok(chain.error, `se esperaba un error ${kind}`)
  assert.equal(chain.error.kind, kind, chain.error.detail)
  assert.equal(chain.error.sequence, sequence)
  assert.equal(chain.verified, sequence - 1, 'verificado hasta el anterior al primer error')
}

before(async () => {
  await prepareAuditTestData(await payloadFor())
})

test('ida y vuelta: escribir, leer por SQL en lotes, recalcular el HMAC y comparar', async () => {
  const chainId = await writeChain(7)
  const { report, chain } = await verify(chainId)
  assert.equal(chain.error, null, chain.error?.detail)
  assert.deepEqual(chain.anomalies, [])
  assert.equal(chain.verified, 7)
  assert.equal(chain.batches, 4, 'lotes de 2: no carga la cadena entera')
  assert.ok(report.ok)
  const last = await (
    await db()
  ).execute(
    sql`SELECT sequence::text AS sequence, chain_hash FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence DESC LIMIT 1`
  )
  assert.deepEqual(chain.head, {
    sequence: (last.rows[0] as { sequence: string }).sequence,
    chainHash: (last.rows[0] as { chain_hash: string }).chain_hash,
  })
})

test('más de 9 eventos: lotes y cabeza en orden numérico, no de texto', async () => {
  // Regresión: con sequence pedida como texto, ORDER BY sequence ordenaba 1, 10, 11, …, 2.
  const chainId = await writeChain(12)
  const { chain } = await verify(chainId, { batchSize: 5 })
  assert.equal(chain.error, null, chain.error?.detail)
  assert.equal(chain.verified, 12)
  assert.equal(chain.batches, 3)
  assert.equal(chain.head?.sequence, '12')
})

test('numeric llega como texto: sin conversión explícita el sobre no se puede rearmar', async () => {
  const chainId = await writeChain(2)
  const raw = await (
    await db()
  ).execute(
    sql`SELECT sequence, schema_version FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence`
  )
  const row = raw.rows[1] as { sequence: unknown; schema_version: unknown }
  assert.equal(typeof row.sequence, 'string', 'node-postgres devuelve numeric como texto')
  assert.equal(row.sequence, '2')
  assert.equal(typeof row.schema_version, 'string')
  // Con "2" en lugar de 2 el sobre no valida (y firmaría otro JSON canónico).
  const { hmac } = getAuditKeys()
  assert.ok(hmac.keys.size > 0)
  assert.throws(() =>
    parseAuditEnvelope({ schema_version: row.schema_version, sequence: row.sequence })
  )
  // El verificador convierte y la cadena verifica.
  assert.equal((await verify(chainId)).chain.error, null)
})

test('sequence guardada como 3.0 (numeric no entero exacto): secuencia inválida', async () => {
  const chainId = await writeChain(4)
  await (
    await db()
  ).execute(sql`UPDATE audit_logs SET sequence = 3.0 WHERE chain_id = ${chainId} AND sequence = 3`)
  assertError((await verify(chainId)).chain, 'sequence_invalid', 3)
})

test('payload alterado: hash incorrecto en ese evento', async () => {
  const chainId = await writeChain(5)
  await (
    await db()
  ).execute(
    sql`UPDATE audit_logs SET payload = '{}'::jsonb WHERE chain_id = ${chainId} AND sequence = 4`
  )
  const { report, chain } = await verify(chainId)
  assertError(chain, 'hash_mismatch', 4)
  assert.equal(report.ok, false)
})

test('evento borrado en el medio: hueco en la secuencia (y su contexto queda huérfano)', async () => {
  const chainId = await writeChain(5)
  const database = await db()
  // La secuencia 2 tiene contexto de red (índice par); se borra el evento y queda el contexto.
  await database.execute(sql`DELETE FROM audit_logs WHERE chain_id = ${chainId} AND sequence = 2`)
  const { report, chain } = await verify(chainId)
  assertError(chain, 'sequence_gap', 2)
  assert.match(chain.error!.detail, /falta la secuencia 2 \(sigue la 3\)/)
  assert.equal(report.orphanNetworkContexts, 1)
})

test('dos eventos con el orden cambiado: enlace roto', async () => {
  const chainId = await writeChain(5)
  const database = await db()
  await database.execute(
    sql`UPDATE audit_logs SET sequence = -2 WHERE chain_id = ${chainId} AND sequence = 2`
  )
  await database.execute(
    sql`UPDATE audit_logs SET sequence = 2 WHERE chain_id = ${chainId} AND sequence = 3`
  )
  await database.execute(
    sql`UPDATE audit_logs SET sequence = 3 WHERE chain_id = ${chainId} AND sequence = -2`
  )
  assertError((await verify(chainId)).chain, 'broken_link', 2)
})

test('evento insertado a mano con un hash inventado: hash incorrecto', async () => {
  const chainId = await writeChain(5)
  const forged = randomBytes(32).toString('hex')
  // Copia del último evento con secuencia 6, enlazado bien con la cabeza, pero con un hash inventado.
  await (
    await db()
  ).execute(sql`
    INSERT INTO audit_logs (id, schema_version, scope_kind, chain_id, organization_id, sequence,
      created_at, category_code, action_code, section_code, entity_type, entity_id, actor_type,
      actor_id, actor_collection, actor_role, operation_id, origin, outcome, payload, hmac_key_id,
      previous_hash, chain_hash)
    SELECT gen_random_uuid()::text, schema_version, scope_kind, chain_id, organization_id, 6,
      created_at, category_code, action_code, section_code, entity_type, 'report-falso', actor_type,
      actor_id, actor_collection, actor_role, gen_random_uuid()::text, origin, outcome, payload,
      hmac_key_id, chain_hash, ${forged}
    FROM audit_logs WHERE chain_id = ${chainId} AND sequence = 5`)
  const { chain } = await verify(chainId)
  assertError(chain, 'hash_mismatch', 6)
  assert.deepEqual(
    chain.head,
    { sequence: '6', chainHash: forged },
    'la cabeza es el evento inventado'
  )
})

test('clave HMAC ausente del llavero: se informa como clave ausente, no como hash incorrecto', async () => {
  const chainId = await writeChain(2)
  const keys = getAuditKeys()
  const withoutHmac = { ...keys, hmac: { ...keys.hmac, keys: new Map() } }
  const { chain } = await verify(chainId, { keys: withoutHmac })
  assertError(chain, 'key_missing', 1)
  assert.match(chain.error!.detail, new RegExp(`"${keys.hmac.activeKeyId}"`))
})

test('contexto de red: faltante antes de vencer es anomalía; después, no; alterado, también', async () => {
  const chainId = await writeChain(4) // las secuencias 2 y 4 tienen IP
  const database = await db()
  const eventAt = async (sequence: number) =>
    (
      (
        await database.execute(
          sql`SELECT id FROM audit_logs WHERE chain_id = ${chainId} AND sequence = ${sequence}`
        )
      ).rows[0] as { id: string }
    ).id
  await database.execute(
    sql`DELETE FROM audit_network_contexts WHERE event_id = ${await eventAt(2)}`
  )
  await database.execute(
    sql`UPDATE audit_network_contexts SET ciphertext = ${randomBytes(30).toString('base64')} WHERE event_id = ${await eventAt(4)}`
  )
  const { report, chain } = await verify(chainId)
  assert.equal(chain.error, null, 'la cadena en sí verifica: el contexto está fuera de ella')
  assert.deepEqual(
    chain.anomalies.map(anomaly => [anomaly.sequence, anomaly.kind]),
    [
      [2, 'network_context_missing'],
      [4, 'network_context_invalid'],
    ]
  )
  assert.equal(report.ok, false)
  // Pasado el vencimiento (365 días), un contexto faltante es la purga, no una anomalía.
  const later = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000)
  const { chain: afterPurge } = await verify(chainId, { now: later })
  assert.deepEqual(
    afterPurge.anomalies.map(anomaly => [anomaly.sequence, anomaly.kind]),
    [[4, 'network_context_invalid']]
  )
})

function runCli(args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PAYLOAD_DISABLE_JOBS: '1',
  }
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/audit-verify.ts', ...args], {
    cwd: ROOT,
    env,
  })
  let output = ''
  child.stdout.on('data', chunk => (output += chunk))
  child.stderr.on('data', chunk => (output += chunk))
  return new Promise<{ code: number | null; output: string }>(resolve =>
    child.on('exit', code => resolve({ code, output }))
  )
}

test('pnpm audit:verify: informe con cabeza y límite conocido, sin payloads ni IPs; exit 0/1/2', async () => {
  const chainId = await writeChain(3)
  const ok = await runCli(['--chain', chainId])
  assert.equal(ok.code, 0, ok.output)
  assert.match(ok.output, new RegExp(`✔ ${chainId}: OK, eventos 1–3\\.`))
  assert.match(ok.output, /cabeza 3 [0-9a-f]{64}/)
  assert.match(ok.output, /No detecta que se borren los últimos eventos/)
  for (const secret of [MARKER, IP, 'Ñandú'])
    assert.ok(!ok.output.includes(secret), `imprimió ${secret}`)

  await (
    await db()
  ).execute(
    sql`UPDATE audit_logs SET payload = '{}'::jsonb WHERE chain_id = ${chainId} AND sequence = 2`
  )
  const broken = await runCli(['--chain', chainId])
  assert.equal(broken.code, 1, broken.output)
  assert.match(broken.output, /✖ .*ERROR en la secuencia 2 .*hash incorrecto.*verificado 1–1/)
  assert.ok(!broken.output.includes(MARKER))

  const usage = await runCli(['--cadena', chainId])
  assert.equal(usage.code, 2)
  assert.match(usage.output, /uso: pnpm audit:verify/)
})

test('una sola foto: la verificación corre en REPEATABLE READ de solo lectura', async () => {
  const chainId = await writeChain(1)
  const { report } = await verify(chainId)
  assert.deepEqual(report.snapshot, { isolation: 'repeatable read', readOnly: true })
})

test('eventos confirmados entre dos lotes no entran: cabeza y verificado son de la misma foto', async () => {
  const chainId = await writeChain(4)
  const org = chainId.slice('org:'.length)
  const payload = await payloadFor()
  let written = 0
  const { chain } = await verify(chainId, {
    beforeNextBatch: async ({ batch }) => {
      if (batch !== 2) return
      // Otra transacción confirma tres eventos más mientras el verificador va por la mitad.
      for (let index = 5; index <= 7; index++)
        await withTransaction(payload, undefined, req => addAuditEvent(req, event(org, index)))
      written = 3
    },
  })
  assert.equal(written, 3, 'el hook corrió entre lotes')
  assert.equal(chain.error, null, chain.error?.detail)
  assert.deepEqual(chain.anomalies, [])
  assert.equal(chain.verified, 4, 'no ve lo confirmado después de su foto')
  assert.equal(chain.head?.sequence, '4', 'la cabeza es la de la misma foto')
  // Una verificación nueva ve los siete.
  assert.equal((await verify(chainId)).chain.verified, 7)
})

test('verificar mientras otro proceso escribe eventos: sin errores ni anomalías', async () => {
  const org = auditTestOrganizationId()
  const chainId = `org:${org}`
  const total = 30
  const writer = `(async () => {
    const { getPayload } = await import('payload')
    const { default: config } = await import('./payload.config.ts')
    const { withTransaction } = await import('./domain/with-transaction.ts')
    const { addAuditEvent } = await import('./domain/audit/builder.ts')
    const payload = await getPayload({ config })
    console.log('listo')
    for (let index = 1; index <= ${total}; index++) {
      await withTransaction(payload, undefined, req => addAuditEvent(req, {
        action: 'scan.rename',
        scope: { kind: 'organization', organizationId: '${org}', officeIds: ${JSON.stringify(OFFICES)} },
        entity: { type: 'scan_report', id: 'report-' + index },
        actor: { type: 'user', id: '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170', role: 'org_admin' },
        origin: 'interactive',
        payload: { index },
        network: index % 2 === 0
          ? { source: 'trusted_proxy', ip: '${IP}', family: 'ipv4', captured_at: new Date().toISOString() }
          : { source: 'unknown', ip: null, family: null, captured_at: new Date().toISOString() },
      }))
    }
    process.exit(0)
  })().catch(error => { console.error(error); process.exit(1) })`
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', PAYLOAD_DISABLE_JOBS: '1' }
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', writer], { cwd: ROOT, env })
  let output = ''
  const ready = new Promise<void>(resolve =>
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('listo')) resolve()
    })
  )
  child.stderr.on('data', chunk => (output += chunk))
  let exited = false
  const exit = new Promise<number | null>(resolve =>
    child.on('exit', code => {
      exited = true
      resolve(code)
    })
  )
  await Promise.race([ready, exit])

  const seen = new Set<number>()
  let runs = 0
  while (!exited) {
    const { report, chain } = await verify(chainId, { batchSize: 3 })
    runs += 1
    assert.equal(chain.error, null, `corrida ${runs}: ${chain.error?.detail}`)
    assert.deepEqual(chain.anomalies, [], `corrida ${runs}: anomalías`)
    assert.equal(report.orphanNetworkContexts, 0, `corrida ${runs}: contextos sin evento`)
    assert.equal(chain.verified, Number(chain.head?.sequence ?? 0), `corrida ${runs}: misma foto`)
    seen.add(chain.verified)
  }
  assert.equal(await exit, 0, output)
  assert.ok(
    seen.size >= 3,
    `las verificaciones se superpusieron con la escritura (${[...seen].join(', ')})`
  )
  const final = await verify(chainId)
  assert.equal(final.chain.verified, total)
  assert.ok(final.report.ok)
})
