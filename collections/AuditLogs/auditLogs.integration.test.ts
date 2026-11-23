import { afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getPayload, type Payload, type PayloadRequest, type RequestContext } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '../../payload.config'
import {
  internalAuditWriteContext,
  pendingInternalAuditWrites,
  revokeInternalAuditWrite,
} from '@/domain/audit/internal-write'
import { auditTestOrganizationId, prepareAuditTestData } from '@/testing/audit-test-data'

// Colecciones AuditLogs y AuditNetworkContexts contra PostgreSQL real (F1b, paso 3): id propio
// aceptado, office_ids en orden en audit_logs_texts, fechas tal cual, create solo con la marca
// interna, update/delete rechazados aun con overrideAccess, lectura directa denegada y unicidad
// de (chain_id, sequence) y de event_id. Las filas no tienen hashes reales: se borran con SQL
// directo (el guard de la aplicación no lo permite) al empezar, después de cada test y al
// terminar (testing/audit-test-data.ts); en una base de desarrollo, audit:verify las reportaría.

const ORG = auditTestOrganizationId()
const CHAIN = `org:${ORG}`
const OFFICES = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

let cached: Payload | undefined
const payloadFor = async () => (cached ??= await getPayload({ config }))
const drizzle = (payload: Payload) => (payload.db as unknown as PostgresAdapter).drizzle

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    schema_version: 1,
    scope_kind: 'organization',
    chain_id: CHAIN,
    organization_id: ORG,
    office_ids: OFFICES,
    sequence: 1,
    created_at: '2026-11-23T12:34:56.789Z',
    occurred_at: null,
    category_code: 'inventory_evidence',
    action_code: 'scan.rename',
    section_code: 'inventory',
    entity_type: 'scan_report',
    entity_id: randomUUID(),
    actor_type: 'user',
    actor_id: randomUUID(),
    actor_collection: 'users',
    actor_role: 'org_admin',
    initiated_by_type: null,
    initiated_by_id: null,
    operation_id: randomUUID(),
    parent_event_id: null,
    visit_id: null,
    origin: 'interactive',
    outcome: 'success',
    payload: { changes: [{ field: 'display_name', before: 'A', after: 'Ñandú' }] },
    network_digest: null,
    network_expires_at: null,
    hmac_key_id: 'test-f1b-paso3',
    previous_hash: null,
    chain_hash: 'a'.repeat(64),
    ...overrides,
  }
}

function contextRow(eventId: string) {
  return {
    event_id: eventId,
    chain_id: CHAIN,
    cipher_version: 1,
    key_id: 'test-f1b-paso3',
    nonce: 'AAAAAAAAAAAAAAAA',
    tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    ciphertext: 'AAAA',
  }
}

type AuditCollection = 'audit-logs' | 'audit-network-contexts'

/** Create interno: con la marca de un solo uso, revocada al terminar. */
async function createInternal(
  collection: AuditCollection,
  data: Record<string, unknown>,
  req?: PayloadRequest
) {
  const payload = await payloadFor()
  const context = internalAuditWriteContext()
  try {
    return await payload.create({
      collection,
      data: data as never,
      overrideAccess: true,
      context,
      req,
      depth: 0,
    })
  } finally {
    revokeInternalAuditWrite(context)
  }
}

const forbidden = (pattern: RegExp) => (error: unknown) => {
  const { status, message } = error as { status?: number; message?: string }
  assert.equal(status, 403, `se esperaba 403: ${message}`)
  assert.match(message ?? '', pattern)
  return true
}

async function countRows(table: 'audit_logs' | 'audit_network_contexts') {
  const payload = await payloadFor()
  const result = await drizzle(payload).execute(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE chain_id = ${CHAIN}`
  )
  return (result.rows[0] as { n: number }).n
}

before(async () => {
  await prepareAuditTestData(await payloadFor())
})

afterEach(async () => {
  const payload = await payloadFor()
  await drizzle(payload).execute(sql`DELETE FROM audit_network_contexts WHERE chain_id = ${CHAIN}`)
  await drizzle(payload).execute(sql`DELETE FROM audit_logs WHERE chain_id = ${CHAIN}`)
})

test('acepta el id propio y conserva office_ids en orden, fechas y payload', async () => {
  const payload = await payloadFor()
  const row = eventRow({ sequence: 1 })
  const created = await createInternal('audit-logs', row)
  assert.equal(created.id, row.id, 'Payload tiene que aceptar el id que genera el builder')

  const read = await payload.findByID({
    collection: 'audit-logs',
    id: row.id,
    overrideAccess: true,
    depth: 0,
  })
  assert.equal(read.id, row.id)
  assert.deepEqual(read.office_ids, OFFICES)
  assert.equal(read.created_at, row.created_at)
  assert.equal(read.sequence, 1)
  assert.deepEqual(read.payload, row.payload)

  // office_ids vive en audit_logs_texts, con su orden (decisión de Tani, 23/11).
  const texts = await drizzle(payload).execute(
    sql`SELECT "text", "order" FROM audit_logs_texts WHERE parent_id = ${row.id} ORDER BY "order"`
  )
  assert.deepEqual(
    texts.rows.map(r => (r as { text: string }).text),
    OFFICES
  )
})

test('sin la marca interna, create se rechaza (con y sin overrideAccess) y no deja fila', async () => {
  const payload = await payloadFor()
  const before = await countRows('audit_logs')
  for (const overrideAccess of [true, false]) {
    await assert.rejects(
      payload.create({
        collection: 'audit-logs',
        data: eventRow({ sequence: 900 }) as never,
        overrideAccess,
        context: { audit: true },
      }),
      forbidden(/solo se escribe desde el cierre transaccional/)
    )
  }
  assert.equal(await countRows('audit_logs'), before)
})

test('la marca es de un solo uso y no queda pegada al req compartido', async () => {
  const payload = await payloadFor()
  const req = { context: {} } as unknown as PayloadRequest
  const pending = pendingInternalAuditWrites()
  await createInternal('audit-logs', eventRow({ sequence: 2 }), req)
  assert.equal(Object.getOwnPropertySymbols(req.context).length, 0, 'la marca quedó en el req')
  await assert.rejects(
    payload.create({
      collection: 'audit-logs',
      data: eventRow({ sequence: 3 }) as never,
      overrideAccess: true,
      req,
    }),
    forbidden(/solo se escribe/)
  )
  // Reusar el mismo objeto de contexto tampoco sirve.
  const context: RequestContext = internalAuditWriteContext()
  await payload.create({
    collection: 'audit-logs',
    data: eventRow({ sequence: 4 }) as never,
    overrideAccess: true,
    context,
  })
  await assert.rejects(
    payload.create({
      collection: 'audit-logs',
      data: eventRow({ sequence: 5 }) as never,
      overrideAccess: true,
      context,
    }),
    forbidden(/solo se escribe/)
  )
  revokeInternalAuditWrite(context)
  assert.equal(pendingInternalAuditWrites(), pending, 'quedaron marcas sin consumir ni revocar')
})

test('update y delete se rechazan siempre, también con overrideAccess', async () => {
  const payload = await payloadFor()
  const row = eventRow({ sequence: 10, outcome: 'success' })
  await createInternal('audit-logs', row)
  const byWhere = { id: { equals: row.id } }
  for (const overrideAccess of [true, false]) {
    await assert.rejects(
      payload.update({
        collection: 'audit-logs',
        id: row.id,
        data: { outcome: 'failed' },
        overrideAccess,
      }),
      forbidden(/solo agregado/)
    )
    await assert.rejects(
      payload.update({
        collection: 'audit-logs',
        where: byWhere,
        data: { outcome: 'failed' },
        overrideAccess,
      }),
      forbidden(/solo agregado/)
    )
    await assert.rejects(
      payload.delete({ collection: 'audit-logs', id: row.id, overrideAccess }),
      forbidden(/solo agregado/)
    )
    await assert.rejects(
      payload.delete({ collection: 'audit-logs', where: byWhere, overrideAccess }),
      forbidden(/solo agregado/)
    )
  }
  const read = await payload.findByID({
    collection: 'audit-logs',
    id: row.id,
    overrideAccess: true,
  })
  assert.equal(read.outcome, 'success')
})

test('la lectura directa sin overrideAccess (lo que hace REST) se deniega', async () => {
  const payload = await payloadFor()
  for (const collection of ['audit-logs', 'audit-network-contexts'] as const) {
    await assert.rejects(payload.find({ collection, overrideAccess: false }), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 403)
      return true
    })
  }
})

test('(chain_id, sequence) es único', async () => {
  await createInternal('audit-logs', eventRow({ sequence: 20 }))
  await assert.rejects(createInternal('audit-logs', eventRow({ sequence: 20 })))
  const payload = await payloadFor()
  const found = await payload.find({
    collection: 'audit-logs',
    where: { and: [{ chain_id: { equals: CHAIN } }, { sequence: { equals: 20 } }] },
    overrideAccess: true,
  })
  assert.equal(found.totalDocs, 1)
})

test('AuditNetworkContexts: create solo con la marca, event_id único, sin update ni delete', async () => {
  const payload = await payloadFor()
  const eventId = randomUUID()
  const created = (await createInternal('audit-network-contexts', contextRow(eventId))) as {
    id: string
    event_id: string
  }
  assert.equal(created.event_id, eventId)

  await assert.rejects(
    payload.create({
      collection: 'audit-network-contexts',
      data: contextRow(randomUUID()),
      overrideAccess: true,
    }),
    forbidden(/solo se escribe/)
  )
  await assert.rejects(createInternal('audit-network-contexts', contextRow(eventId)))
  await assert.rejects(
    payload.update({
      collection: 'audit-network-contexts',
      id: created.id,
      data: { key_id: 'otra' },
      overrideAccess: true,
    }),
    forbidden(/solo agregado/)
  )
  await assert.rejects(
    payload.delete({ collection: 'audit-network-contexts', id: created.id, overrideAccess: true }),
    forbidden(/solo agregado/)
  )
  assert.equal(await countRows('audit_network_contexts'), 1)
})
