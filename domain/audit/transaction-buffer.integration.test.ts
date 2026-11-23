import { afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '../../payload.config'
import { withTransaction } from '../with-transaction'
import {
  addAuditEvent,
  bufferedAuditEvents,
  openAuditTransactionCount,
  type AuditEventInput,
} from './builder'
import { auditTestOrganizationId, prepareAuditTestData } from '@/testing/audit-test-data'

// Buffer de auditoría y caminos de cierre de withTransaction contra PostgreSQL real (F1b, paso 4b,
// pedido de Tani del 23/11): todo cierre (commit, rollback, excepción, reintento, lock ocupado,
// rollback que falla) borra la entrada de su transacción, y una transacción nueva nunca ve
// eventos de una anterior revertida. Datos de prueba según testing/audit-test-data.ts: limpieza
// al empezar (restos de una corrida cortada), después de cada test y al terminar.

const ORG = auditTestOrganizationId()
// Tabla auxiliar en un schema propio, nunca en public (testing/audit-test-data.ts).
const SCHEMA = 'siam_test_audit_buffer'
const PROBE = sql`${sql.identifier(SCHEMA)}.probe`

let cached: Payload | undefined
const payloadFor = async () => (cached ??= await getPayload({ config }))
const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle
const sessionDb = (req: PayloadRequest, id: string | number) =>
  req.payload.db.sessions![id]!.db as unknown as PostgresAdapter['drizzle']

function event(): AuditEventInput {
  return {
    action: 'scan.rename',
    scope: { kind: 'organization', organizationId: ORG },
    entity: { type: 'scan_report', id: `report-${randomUUID()}` },
    actor: { type: 'user', id: randomUUID(), role: 'org_admin' },
    origin: 'interactive',
    payload: { changes: [] },
    network: { source: 'unknown', ip: null, family: null, captured_at: new Date().toISOString() },
  }
}

async function probeCount() {
  const result = await drizzle(await payloadFor()).execute(
    sql`SELECT count(*)::int AS n FROM ${PROBE}`
  )
  return (result.rows[0] as { n: number }).n
}

let baseline = 0
before(async () => {
  const payload = await payloadFor()
  await prepareAuditTestData(payload, { schema: SCHEMA })
  await drizzle(payload).execute(sql`CREATE TABLE ${PROBE} (id text PRIMARY KEY)`)
  baseline = openAuditTransactionCount()
})

// afterEach y no after: el after del preload de integración cierra Payload primero.
afterEach(async () => {
  assert.equal(openAuditTransactionCount(), baseline, 'quedó una entrada del buffer abierta')
  const db = drizzle(await payloadFor())
  await db.execute(sql`DELETE FROM audit_network_contexts WHERE chain_id = ${`org:${ORG}`}`)
  await db.execute(sql`DELETE FROM audit_logs WHERE chain_id = ${`org:${ORG}`}`)
  await db.execute(sql`DELETE FROM ${PROBE}`)
})

test('excepción en medio de la transacción: rollback y el mapa queda sin la entrada', async () => {
  const payload = await payloadFor()
  let id: string | number | undefined
  await assert.rejects(
    withTransaction(payload, undefined, async req => {
      id = (await req.transactionID) as string
      await sessionDb(req, id).execute(sql`INSERT INTO ${PROBE} VALUES ('a')`)
      await addAuditEvent(req, event())
      assert.equal(bufferedAuditEvents(id).length, 1)
      throw new Error('falla en medio del comando')
    }),
    /falla en medio del comando/
  )
  assert.ok(id)
  assert.deepEqual(bufferedAuditEvents(id), [])
  assert.equal(openAuditTransactionCount(), baseline)
  assert.equal(await probeCount(), 0, 'la escritura de negocio se revirtió')
})

test('una transacción nueva nunca ve eventos de una anterior revertida', async () => {
  const payload = await payloadFor()
  let first: string | number | undefined
  await assert.rejects(
    withTransaction(payload, undefined, async req => {
      first = (await req.transactionID) as string
      await addAuditEvent(req, event())
      throw new Error('revertida')
    })
  )
  await withTransaction(payload, undefined, async req => {
    const second = (await req.transactionID) as string
    assert.notEqual(second, first)
    assert.deepEqual(bufferedAuditEvents(second), [], 'empieza vacía')
  })
  assert.deepEqual(bufferedAuditEvents(first!), [])
})

test('reintento por conflicto (40001): el intento nuevo tiene otro id y empieza vacío', async () => {
  const payload = await payloadFor()
  const ids: Array<string | number> = []
  await withTransaction(payload, undefined, async req => {
    const id = (await req.transactionID) as string
    ids.push(id)
    assert.deepEqual(bufferedAuditEvents(id), [], `intento ${ids.length}: buffer vacío`)
    if (ids.length === 1) {
      await addAuditEvent(req, event())
      throw Object.assign(new Error('conflicto de serialización simulado'), { code: '40001' })
    }
  })
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
  assert.deepEqual(bufferedAuditEvents(ids[0]!), [])
})

test('commit con eventos: escribe en la cadena y confirma junto con el cambio de negocio', async () => {
  const payload = await payloadFor()
  let eventId = ''
  await withTransaction(payload, undefined, async req => {
    const id = (await req.transactionID) as string
    await sessionDb(req, id).execute(sql`INSERT INTO ${PROBE} VALUES ('b')`)
    eventId = await addAuditEvent(req, event())
  })
  assert.equal(await probeCount(), 1)
  const written = await payload.findByID({
    collection: 'audit-logs',
    id: eventId,
    overrideAccess: true,
  })
  assert.equal(written.chain_id, `org:${ORG}`)
})

test('una transacción heredada solo acumula; la cierra su dueño', async () => {
  const payload = await payloadFor()
  let id: string | number | undefined
  await assert.rejects(
    withTransaction(payload, undefined, async req => {
      id = (await req.transactionID) as string
      await withTransaction(payload, req, async inner => {
        assert.equal(await inner.transactionID, id, 'hereda la misma transacción')
        await addAuditEvent(inner, event())
      })
      assert.equal(bufferedAuditEvents(id).length, 1, 'el anidado no cerró el buffer')
      throw new Error('el dueño revierte')
    })
  )
  assert.deepEqual(bufferedAuditEvents(id!), [])
})

test('una transacción que abre Payload por su cuenta no acepta eventos', async () => {
  const payload = await payloadFor()
  const id = await payload.db.beginTransaction()
  assert.ok(id)
  const req = { transactionID: id, payload } as unknown as PayloadRequest
  try {
    await assert.rejects(addAuditEvent(req, event()), /no la abrió withTransaction/)
  } finally {
    await payload.db.rollbackTransaction(id)
  }
})

test('si el rollback mismo falla, la entrada igual se borra', async () => {
  const payload = await payloadFor()
  const rollback = payload.db.rollbackTransaction
  payload.db.rollbackTransaction = async function (id) {
    await rollback.call(this, id)
    throw new Error('rollback roto')
  }
  let id: string | number | undefined
  try {
    await assert.rejects(
      withTransaction(payload, undefined, async req => {
        id = (await req.transactionID) as string
        await addAuditEvent(req, event())
        throw new Error('falla del comando')
      }),
      /rollback roto/
    )
  } finally {
    payload.db.rollbackTransaction = rollback
  }
  assert.deepEqual(bufferedAuditEvents(id!), [])
})

test('lock ocupado: el intento que espera se revierte con su buffer y reintenta vacío', async () => {
  const payload = await payloadFor()
  const lockKey = `audit-f1b-test:${randomUUID()}`
  let releaseHolder!: () => void
  const held = new Promise<void>(resolve => (releaseHolder = resolve))
  let holderHasLock!: () => void
  const holderReady = new Promise<void>(resolve => (holderHasLock = resolve))
  const holder = withTransaction(
    payload,
    undefined,
    async () => {
      holderHasLock()
      await held
    },
    { lockKey }
  )
  await holderReady
  const attempts: Array<string | number> = []
  const waiter = withTransaction(
    payload,
    undefined,
    async req => {
      const id = (await req.transactionID) as string
      attempts.push(id)
      assert.deepEqual(bufferedAuditEvents(id), [])
    },
    { lockKey }
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  releaseHolder()
  await Promise.all([holder, waiter])
  assert.equal(attempts.length, 1, 'el comando corre una vez, después del lock')
})
