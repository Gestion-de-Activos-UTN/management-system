import { afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '../../payload.config'
import { withTransaction } from '../with-transaction'
import { addAuditEvent, type AuditEventInput } from './builder'
import { auditOrganizationLockKey, configureAuditHeadPool } from './chain'
import { parseAuditEnvelope } from './envelope'
import { computeChainHash, computeNetworkDigest } from './hmac'
import { decryptNetworkContext } from './network-crypto'
import { AuditKeysConfigError, getAuditKeys, resetAuditKeysCache } from './runtime-keys'
import { auditTestOrganizationId, prepareAuditTestData } from '@/testing/audit-test-data'

// Cadena y cierre transaccional contra PostgreSQL real (F1b, paso 4b; plan 06 §3 y §7):
// secuencias sin bifurcar con escrituras concurrentes, primer evento bajo carrera, rollback sin
// evento, varias cadenas en una transacción, REPEATABLE READ con lock al inicio y con cabeza
// vieja (23505 → reintento), deadlock detectado y reintentado, rotación de clave, contexto de red
// cifrado y ligado al evento, claves validadas al cerrar y consultas del cierre en secuencia sobre
// el mismo cliente (Tani, 23/11). Datos de prueba según testing/audit-test-data.ts: organizaciones
// de prueba nuevas en cada test, limpieza al empezar (restos de una corrida cortada), después de
// cada test y al terminar; sin la cadena `platform`.

// Tabla auxiliar en un schema propio, nunca en public (testing/audit-test-data.ts).
const SCHEMA = 'siam_test_audit_chain'
const PROBE = sql`${sql.identifier(SCHEMA)}.probe`
const touchedOrgs = new Set<string>()

let cached: Payload | undefined
const payloadFor = async () => (cached ??= await getPayload({ config }))
const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle
const sessionDb = async (req: PayloadRequest) =>
  req.payload.db.sessions![(await req.transactionID) as string]!
    .db as unknown as PostgresAdapter['drizzle']

function newOrg() {
  const org = auditTestOrganizationId()
  touchedOrgs.add(org)
  return org
}

function event(org: string, overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    action: 'scan.rename',
    scope: { kind: 'organization', organizationId: org },
    entity: { type: 'scan_report', id: `report-${randomUUID()}` },
    actor: { type: 'user', id: randomUUID(), role: 'org_admin' },
    origin: 'interactive',
    payload: { changes: [{ field: 'display_name', before: 'A', after: 'B' }] },
    network: { source: 'unknown', ip: null, family: null, captured_at: new Date().toISOString() },
    ...overrides,
  }
}

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(res => (resolve = res))
  return { promise, resolve }
}

type Row = Record<string, unknown> & { chain_hash: string; sequence: number }

/** Eventos de una cadena en orden, leídos con la Local API (el verificador del paso 6 fija su camino). */
async function chainRows(org: string): Promise<Row[]> {
  const payload = await payloadFor()
  const result = await payload.find({
    collection: 'audit-logs',
    where: { chain_id: { equals: `org:${org}` } },
    sort: 'sequence',
    pagination: false,
    overrideAccess: true,
    depth: 0,
  })
  return result.docs as unknown as Row[]
}

/** Comprueba secuencias 1..n, enlaces y el HMAC de cada evento. */
async function assertValidChain(org: string, expected: number) {
  const rows = await chainRows(org)
  assert.equal(rows.length, expected, 'cantidad de eventos')
  const { hmac } = getAuditKeys()
  rows.forEach((row, index) => {
    assert.equal(row.sequence, index + 1, 'secuencia sin huecos ni repetidos')
    assert.equal(row.previous_hash, index === 0 ? null : rows[index - 1]!.chain_hash, 'enlace')
    const { chain_hash, ...stored } = row
    const envelope = parseAuditEnvelope({ ...stored, office_ids: stored.office_ids ?? [] })
    assert.equal(computeChainHash(envelope, hmac.keys), chain_hash, `HMAC del evento ${index + 1}`)
  })
  return rows
}

before(async () => {
  const payload = await payloadFor()
  await prepareAuditTestData(payload, { schema: SCHEMA })
  await drizzle(payload).execute(sql`CREATE TABLE ${PROBE} (id text PRIMARY KEY, n int NOT NULL)`)
})

afterEach(async () => {
  const db = drizzle(await payloadFor())
  for (const org of touchedOrgs) {
    await db.execute(sql`DELETE FROM audit_network_contexts WHERE chain_id = ${`org:${org}`}`)
    await db.execute(sql`DELETE FROM audit_logs WHERE chain_id = ${`org:${org}`}`)
  }
  touchedOrgs.clear()
  await db.execute(sql`DELETE FROM ${PROBE}`)
})

test('un evento: secuencia 1, sin anterior, HMAC que se recalcula', async () => {
  const org = newOrg()
  await withTransaction(await payloadFor(), undefined, req => addAuditEvent(req, event(org)))
  const [row] = await assertValidChain(org, 1)
  assert.equal(row!.hmac_key_id, getAuditKeys().hmac.activeKeyId)
  assert.match(String(row!.created_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('varios eventos en una transacción y en varias cadenas, en orden', async () => {
  const [orgA, orgB] = [newOrg(), newOrg()]
  const ids: string[] = []
  await withTransaction(await payloadFor(), undefined, async req => {
    const root = await addAuditEvent(req, event(orgB))
    ids.push(root)
    ids.push(await addAuditEvent(req, event(orgA)))
    ids.push(await addAuditEvent(req, event(orgB, { parentEventId: root })))
    ids.push(await addAuditEvent(req, event(orgB)))
  })
  const b = await assertValidChain(orgB, 3)
  assert.deepEqual(
    b.map(row => row.id),
    [ids[0], ids[2], ids[3]],
    'en el orden en que se acumularon'
  )
  assert.equal(b[1]!.parent_event_id, ids[0])
  assert.equal(b[1]!.operation_id, b[0]!.operation_id)
  await assertValidChain(orgA, 1)
})

test('varias cadenas en órdenes opuestos: el cierre las bloquea siempre en el mismo orden', async () => {
  // Sin un orden fijo, una transacción que acumula A y después B y otra que acumula B y después A
  // se bloquean entre sí al cerrar (deadlock → reintento). Con el orden por chain_id no pasa.
  const [orgA, orgB] = [newOrg(), newOrg()]
  const payload = await payloadFor()
  let attempts = 0
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      withTransaction(payload, undefined, async req => {
        attempts += 1
        const [first, second] = index % 2 === 0 ? [orgA, orgB] : [orgB, orgA]
        await addAuditEvent(req, event(first))
        await addAuditEvent(req, event(second))
      })
    )
  )
  assert.equal(attempts, 16, 'ninguna transacción se reintentó por deadlock')
  await assertValidChain(orgA, 16)
  await assertValidChain(orgB, 16)
})

test('rollback: ni el cambio de negocio ni el evento', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  await assert.rejects(
    withTransaction(payload, undefined, async req => {
      await (await sessionDb(req)).execute(sql`INSERT INTO ${PROBE} VALUES ('r', 1)`)
      await addAuditEvent(req, event(org))
      throw new Error('falla después de acumular')
    })
  )
  assert.equal((await chainRows(org)).length, 0)
  const probe = await drizzle(payload).execute(sql`SELECT count(*)::int AS n FROM ${PROBE}`)
  assert.equal((probe.rows[0] as { n: number }).n, 0)
})

test('concurrentes en la misma cadena: sin bifurcar, primer evento incluido', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
    )
  )
  const rows = await assertValidChain(org, 20)
  assert.equal(rows.filter(row => row.previous_hash === null).length, 1, 'un solo primer evento')
})

test('REPEATABLE READ con lock al inicio: escritores concurrentes esperan, sin reintentos', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const holding = deferred()
  const release = deferred()
  let attempts = 0
  const scan = withTransaction(
    payload,
    undefined,
    async req => {
      attempts += 1
      holding.resolve()
      await release.promise // como un escaneo largo
      await addAuditEvent(req, event(org))
    },
    { isolationLevel: 'repeatable read', lockKeys: [auditOrganizationLockKey(org)] }
  )
  await holding.promise
  const writers = Array.from({ length: 5 }, () =>
    withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
  )
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal((await chainRows(org)).length, 0, 'los escritores esperan el lock de la cadena')
  release.resolve()
  await Promise.all([scan, ...writers])
  assert.equal(attempts, 1, 'el comando con el lock no se reintenta')
  const rows = await assertValidChain(org, 6)
  assert.equal(rows[0]!.actor_type, 'user')
})

test('REPEATABLE READ sin lock al inicio: la cabeza se lee fuera de su foto, sin reintento', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const snapshotTaken = deferred()
  const otherCommitted = deferred()
  let attempts = 0
  const stale = withTransaction(
    payload,
    undefined,
    async req => {
      attempts += 1
      await (await sessionDb(req)).execute(sql`SELECT 1`) // fija la foto de REPEATABLE READ
      if (attempts === 1) {
        snapshotTaken.resolve()
        await otherCommitted.promise
      }
      await addAuditEvent(req, event(org))
    },
    { isolationLevel: 'repeatable read' }
  )
  await snapshotTaken.promise
  await withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
  otherCommitted.resolve()
  await stale
  // Su foto no ve el evento confirmado después, pero el cierre lee la cabeza aparte (03 §4.4,
  // cambio del 23/11): no hay cabeza vieja ni 23505.
  assert.equal(attempts, 1, 'confirmó al primer intento')
  await assertValidChain(org, 2)
})

test('cierres REPEATABLE READ simultáneos con el pool de lectura al mínimo (1 conexión)', async () => {
  const [orgA, orgB] = [newOrg(), newOrg()]
  const payload = await payloadFor()
  configureAuditHeadPool(payload, { max: 1 })
  try {
    let attempts = 0
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        withTransaction(
          payload,
          undefined,
          async req => {
            attempts += 1
            await addAuditEvent(req, event(index % 2 === 0 ? orgA : orgB))
            await addAuditEvent(req, event(index % 2 === 0 ? orgB : orgA))
          },
          { isolationLevel: 'repeatable read' }
        )
      )
    )
    assert.equal(attempts, 8, 'ninguno se reintentó')
    await assertValidChain(orgA, 8)
    await assertValidChain(orgB, 8)
  } finally {
    configureAuditHeadPool(payload)
  }
})

test('pool de lectura agotado: error claro después del tiempo máximo, sin cambio de negocio', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const pool = configureAuditHeadPool(payload, { max: 1, timeoutMs: 300 })
  const busy = await pool.connect() // la única conexión, ocupada
  try {
    const started = Date.now()
    await assert.rejects(
      withTransaction(
        payload,
        undefined,
        async req => {
          await (await sessionDb(req)).execute(sql`INSERT INTO ${PROBE} VALUES ('p', 1)`)
          await addAuditEvent(req, event(org))
        },
        { isolationLevel: 'repeatable read' }
      ),
      /no hubo una conexión libre para leer la cabeza de la cadena a tiempo/
    )
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 300 && elapsed < 5000, `esperó ${elapsed} ms`)
  } finally {
    busy.release()
    configureAuditHeadPool(payload)
  }
  assert.equal((await chainRows(org)).length, 0)
  const probe = await drizzle(payload).execute(
    sql`SELECT count(*)::int AS n FROM ${PROBE} WHERE id = 'p'`
  )
  assert.equal((probe.rows[0] as { n: number }).n, 0, 'sin auditoría no hay cambio')
})

test('READ COMMITTED no usa el pool de lectura aparte', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const pool = configureAuditHeadPool(payload, { max: 1, timeoutMs: 300 })
  const busy = await pool.connect() // si el cierre READ COMMITTED lo usara, fallaría por tiempo
  try {
    await withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
  } finally {
    busy.release()
    configureAuditHeadPool(payload)
  }
  await assertValidChain(org, 1)
})

test('deadlock entre fila de negocio y lock de la cadena: se detecta y se reintenta', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  await drizzle(payload).execute(sql`INSERT INTO ${PROBE} VALUES ('x', 0)`)
  const update = async (req: PayloadRequest) =>
    (await sessionDb(req)).execute(sql`UPDATE ${PROBE} SET n = n + 1 WHERE id = 'x'`)
  const scanHasLock = deferred()
  const editHasRow = deferred()
  let scanAttempts = 0
  let editAttempts = 0
  // El "escaneo" toma audit:<org> al inicio y después quiere la fila; la "edición" toma la fila y
  // al cerrar quiere audit:<org>.
  const scan = withTransaction(
    payload,
    undefined,
    async req => {
      scanAttempts += 1
      if (scanAttempts === 1) {
        scanHasLock.resolve()
        await editHasRow.promise
      }
      await update(req)
      await addAuditEvent(req, event(org))
    },
    { isolationLevel: 'repeatable read', lockKeys: [auditOrganizationLockKey(org)] }
  )
  await scanHasLock.promise
  const edit = withTransaction(payload, undefined, async req => {
    editAttempts += 1
    await update(req)
    if (editAttempts === 1) editHasRow.resolve()
    await addAuditEvent(req, event(org))
  })
  await Promise.all([scan, edit])
  assert.ok(scanAttempts + editAttempts >= 3, 'uno de los dos se reintentó')
  const probe = await drizzle(payload).execute(sql`SELECT n FROM ${PROBE} WHERE id = 'x'`)
  assert.equal((probe.rows[0] as { n: number }).n, 2, 'cada comando aplicó su cambio una vez')
  await assertValidChain(org, 2)
})

test('rotación de clave entre eventos: cada uno conserva su versión y la cadena sigue', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const saved = { keys: process.env.AUDIT_HMAC_KEYS, active: process.env.AUDIT_HMAC_ACTIVE_KEY_ID }
  const rotated = `test-rot-${randomBytes(3).toString('hex')}`
  try {
    await withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
    process.env.AUDIT_HMAC_KEYS = `${saved.keys},${rotated}:${randomBytes(32).toString('base64')}`
    process.env.AUDIT_HMAC_ACTIVE_KEY_ID = rotated
    resetAuditKeysCache()
    await withTransaction(payload, undefined, req => addAuditEvent(req, event(org)))
    const rows = await assertValidChain(org, 2) // con el llavero que tiene las dos versiones
    assert.deepEqual(
      rows.map(row => row.hmac_key_id),
      [saved.active, rotated]
    )
  } finally {
    process.env.AUDIT_HMAC_KEYS = saved.keys
    process.env.AUDIT_HMAC_ACTIVE_KEY_ID = saved.active
    resetAuditKeysCache()
  }
})

test('contexto de red: cifrado aparte, ligado al evento y firmado por el digest', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const context = {
    source: 'trusted_proxy',
    ip: '203.0.113.7',
    family: 'ipv4',
    captured_at: '2026-11-23T12:00:00.000Z',
  } as const
  const eventId = await withTransaction(payload, undefined, req =>
    addAuditEvent(req, event(org, { network: context }))
  )
  const [row] = await assertValidChain(org, 1)
  const stored = (
    await payload.find({
      collection: 'audit-network-contexts',
      where: { event_id: { equals: eventId } },
      overrideAccess: true,
    })
  ).docs[0]!
  const binding = { chain_id: `org:${org}`, event_id: eventId }
  const keys = getAuditKeys()
  const decrypted = decryptNetworkContext(
    {
      v: stored.cipher_version,
      key_id: stored.key_id,
      nonce: stored.nonce,
      tag: stored.tag,
      ciphertext: stored.ciphertext,
    },
    binding,
    keys.network.keys
  )
  assert.deepEqual(decrypted, context)
  assert.equal(
    row!.network_digest,
    computeNetworkDigest({ ...binding, context }, String(row!.hmac_key_id), keys.hmac.keys)
  )
  const expires = Date.parse(String(row!.network_expires_at)) - Date.parse(String(row!.created_at))
  assert.equal(expires, 365 * 24 * 60 * 60 * 1000, 'vence a los 365 días')
  // La IP no está en el evento en claro.
  assert.ok(!JSON.stringify(row).includes('203.0.113.7'))
})

test('sin claves al cerrar: la transacción falla entera (segunda línea de defensa)', async () => {
  const org = newOrg()
  const payload = await payloadFor()
  const saved = process.env.AUDIT_HMAC_KEYS
  try {
    delete process.env.AUDIT_HMAC_KEYS
    resetAuditKeysCache()
    await assert.rejects(
      withTransaction(payload, undefined, async req => {
        await (await sessionDb(req)).execute(sql`INSERT INTO ${PROBE} VALUES ('k', 1)`)
        await addAuditEvent(req, event(org))
      }),
      AuditKeysConfigError
    )
  } finally {
    process.env.AUDIT_HMAC_KEYS = saved
    resetAuditKeysCache()
  }
  assert.equal((await chainRows(org)).length, 0)
  const probe = await drizzle(payload).execute(sql`SELECT count(*)::int AS n FROM ${PROBE}`)
  assert.equal((probe.rows[0] as { n: number }).n, 0, 'sin auditoría no hay cambio')
})

/**
 * Envuelve pg.Client#query mientras corre `fn` y cuenta las consultas que llegan a un cliente que
 * ya tiene otra activa o en cola: consultas en paralelo sobre el mismo cliente.
 */
async function parallelQueriesDuring(fn: () => Promise<unknown>) {
  const { Client } = createRequire(import.meta.url)('pg') as {
    Client: { prototype: { query: (...args: unknown[]) => unknown } }
  }
  const query = Client.prototype.query
  let total = 0
  let parallel = 0
  Client.prototype.query = function (
    this: { _activeQuery: unknown; _queryQueue: unknown[] },
    ...args
  ) {
    total += 1
    if (this._activeQuery || this._queryQueue.length > 0) parallel += 1
    return query.apply(this, args)
  }
  try {
    await fn()
  } finally {
    Client.prototype.query = query
  }
  return { total, parallel }
}

test('el cierre hace sus consultas en secuencia sobre el cliente de la transacción', async () => {
  const [orgA, orgB] = [newOrg(), newOrg()]
  const payload = await payloadFor()
  const ip = {
    source: 'direct',
    ip: '198.51.100.20',
    family: 'ipv4',
    captured_at: new Date().toISOString(),
  } as const
  const seen = await parallelQueriesDuring(() =>
    withTransaction(payload, undefined, async req => {
      await addAuditEvent(req, event(orgA, { network: ip }))
      await addAuditEvent(req, event(orgB))
      await addAuditEvent(req, event(orgA, { network: ip }))
      await addAuditEvent(req, event(orgB, { network: ip }))
    })
  )
  assert.ok(seen.total >= 10, `se esperaban las consultas del cierre, hubo ${seen.total}`)
  assert.equal(seen.parallel, 0, 'una consulta llegó con otra activa o en cola en el mismo cliente')
  await assertValidChain(orgA, 2)
  await assertValidChain(orgB, 2)
})

test('control: el detector sí ve consultas en paralelo sobre el mismo cliente', async () => {
  const payload = await payloadFor()
  const seen = await parallelQueriesDuring(() =>
    withTransaction(payload, undefined, async req => {
      const db = await sessionDb(req)
      await Promise.all([
        db.execute(sql`SELECT pg_sleep(0.05)`),
        db.execute(sql`SELECT 1`),
        db.execute(sql`SELECT 2`),
      ])
    })
  )
  assert.ok(seen.parallel > 0, 'el detector no vio el paralelismo a propósito')
})
