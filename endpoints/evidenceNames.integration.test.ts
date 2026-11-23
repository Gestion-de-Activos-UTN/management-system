import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '../payload.config'
import { inventorySnapshotNameEndpoint, scanReportNameEndpoint } from './evidenceNames'
import { createInventorySnapshot } from '../domain/inventories/createInventorySnapshot'
import { resetAuditKeysCache } from '../domain/audit/runtime-keys'
import { verifyAuditChains } from '../domain/audit/verify'
import { onIntegrationTeardown } from '../testing/integration-teardown'

// Mismo enfoque que nonNetworkAssetReview.integration.test.ts (Local API real + PayloadRequest mínimo).
// Desde F1b (A095), cada renombre real emite scan.rename / snapshot.rename en la misma transacción.
// Las organizaciones se siembran con Payload (ids al azar, no con el prefijo de prueba del
// AuditLog): sus eventos se borran al terminar el archivo (onIntegrationTeardown). Si una corrida
// se corta, quedan eventos válidos de organizaciones de prueba (no rompen la siguiente).

function fakeRequest(
  payload: Payload,
  user: { id: string; collection: 'users' | 'admins' },
  id: string,
  body: unknown,
  url?: string
) {
  return {
    payload,
    user,
    url,
    context: {},
    routeParams: { id },
    json: async () => body,
  } as unknown as PayloadRequest
}

const ROLES = {
  org_admin: { rank: 2, scope: 'organization' },
  office_manager: { rank: 5, scope: 'organization_office' },
  org_viewer: { rank: 10, scope: 'organization_office' },
} as const

async function role(payload: Payload, slug: keyof typeof ROLES) {
  const found = await payload.find({
    collection: 'roles',
    where: { slug: { equals: slug } },
    overrideAccess: true,
    limit: 1,
  })
  return (
    found.docs[0] ??
    payload.create({
      collection: 'roles',
      data: { slug, name: slug, ...ROLES[slug], is_platform_role: false },
      overrideAccess: true,
    })
  )
}

async function member(
  payload: Payload,
  organizationId: string,
  officeIds: string[],
  slug: keyof typeof ROLES
) {
  const user = await payload.create({
    collection: 'users',
    data: {
      name: slug,
      email: `${slug}-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'x'.repeat(12),
    },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-memberships',
    data: {
      user: user.id,
      organization: organizationId,
      offices: officeIds,
      role: (await role(payload, slug)).id,
      status: 'active',
      is_active: true,
    },
    overrideAccess: true,
  })
  return String(user.id)
}

async function platformAdmin(payload: Payload) {
  const roles = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'platform_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const platformRole =
    roles.docs[0] ??
    (await payload.create({
      collection: 'roles',
      overrideAccess: true,
      data: {
        slug: 'platform_admin',
        name: 'Platform',
        rank: 0,
        scope: 'platform',
        is_platform_role: true,
      },
    }))
  const admin = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      role: platformRole.id,
      email: `platform-${randomUUID()}@example.test`,
      password: 'x'.repeat(16),
      status: 'active',
    },
  })
  return String(admin.id)
}

const seededOrganizations = new Set<string>()

async function seed(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const org = String(organization.id)
  seededOrganizations.add(org)
  const [officeA, officeB] = await Promise.all(
    ['Oficina A', 'Oficina B'].map(name =>
      payload.create({
        collection: 'offices',
        data: { organization: organization.id, name },
        overrideAccess: true,
      })
    )
  )
  // El dominio real arma risk_score y assets_dump, igual que en producción.
  const snapshot = await createInventorySnapshot(payload, String(officeA.id), { type: 'scheduled' })
  return {
    org,
    officeA: String(officeA.id),
    snapshot,
    admin: await member(payload, org, [String(officeA.id), String(officeB.id)], 'org_admin'),
    managerA: await member(payload, org, [String(officeA.id)], 'office_manager'),
    managerB: await member(payload, org, [String(officeB.id)], 'office_manager'),
    viewer: await member(payload, org, [String(officeA.id)], 'org_viewer'),
  }
}

async function scanReport(payload: Payload, officeId: string) {
  const agentId = randomUUID()
  await payload.create({
    collection: 'agents',
    data: { id: agentId, office: officeId },
    overrideAccess: true,
  })
  return payload.create({
    collection: 'scan-reports',
    data: {
      id: `r-${randomUUID()}`,
      agent: agentId,
      office: officeId,
      execution_status: 'completed',
      received_at: new Date().toISOString(),
    },
    overrideAccess: true,
  })
}

async function events(payload: Payload, entityId: string) {
  const found = await payload.find({
    collection: 'audit-logs',
    where: { entity_id: { equals: entityId } },
    sort: 'sequence',
    pagination: false,
    overrideAccess: true,
    depth: 0,
  })
  return found.docs
}

const user = (id: string) => ({ id, collection: 'users' as const })

before(async () => {
  const payload = await getPayload({ config })
  onIntegrationTeardown(async () => {
    const db = (payload.db as unknown as PostgresAdapter).drizzle
    for (const org of seededOrganizations) {
      await db.execute(sql`DELETE FROM audit_network_contexts WHERE chain_id = ${`org:${org}`}`)
      await db.execute(sql`DELETE FROM audit_logs WHERE chain_id = ${`org:${org}`}`)
    }
  })
})

test('PATCH /v1/inventory-snapshots/:id/name: renombra sin tocar la evidencia y respeta el alcance', async () => {
  const payload = await getPayload({ config })
  const { snapshot, admin, managerA, managerB, viewer } = await seed(payload)
  const id = String(snapshot.id)
  const call = (userId: string, body: unknown) =>
    inventorySnapshotNameEndpoint.handler(fakeRequest(payload, user(userId), id, body))

  // Sin 'update' en la matriz: 403.
  assert.equal((await call(viewer, { display_name: 'X' })).status, 403)
  // Office manager de otra oficina: fuera de alcance.
  await assert.rejects(async () => call(managerB, { display_name: 'X' }), { status: 403 })
  // Demasiado largo: 400.
  assert.equal((await call(admin, { display_name: 'x'.repeat(81) })).status, 400)
  assert.deepEqual(await events(payload, id), [], 'los pedidos rechazados no dejan evento')

  const renamed = await call(managerA, { display_name: '  Cierre de trimestre  ' })
  assert.equal(renamed.status, 200)
  assert.deepEqual(await renamed.json(), { id: snapshot.id, display_name: 'Cierre de trimestre' })

  const reloaded = await payload.findByID({
    collection: 'inventory-snapshots',
    id,
    overrideAccess: true,
  })
  assert.equal(reloaded.display_name, 'Cierre de trimestre')
  assert.equal(reloaded.taken_at, snapshot.taken_at)
  assert.deepEqual(reloaded.assets_dump, snapshot.assets_dump)

  // Vacío vuelve al título por defecto.
  const cleared = await call(admin, { display_name: '   ' })
  assert.equal((await cleared.json()).display_name, null)
})

test('A095: el renombre de una instantánea emite snapshot.rename con antes y después', async () => {
  const payload = await getPayload({ config })
  const { org, officeA, snapshot, managerA } = await seed(payload)
  const id = String(snapshot.id)
  const call = (body: unknown) =>
    inventorySnapshotNameEndpoint.handler(fakeRequest(payload, user(managerA), id, body))

  assert.equal((await call({ display_name: 'Cierre Q4' })).status, 200)
  // Mismo nombre: sin cambio real, sin evento.
  assert.equal((await call({ display_name: ' Cierre Q4 ' })).status, 200)
  assert.equal((await call({ display_name: '' })).status, 200)

  const written = await events(payload, id)
  assert.equal(written.length, 2)
  const [first, second] = written
  assert.equal(first!.action_code, 'snapshot.rename')
  assert.equal(first!.category_code, 'inventory_evidence')
  assert.equal(first!.section_code, 'inventory')
  assert.equal(first!.entity_type, 'inventory_snapshot')
  assert.equal(first!.chain_id, `org:${org}`)
  assert.deepEqual(first!.office_ids, [officeA])
  assert.deepEqual(
    [first!.actor_type, first!.actor_id, first!.actor_collection, first!.actor_role],
    ['user', managerA, 'users', 'office_manager']
  )
  assert.equal(first!.origin, 'interactive')
  assert.equal(first!.outcome, 'success')
  assert.deepEqual(first!.payload, {
    entity_snapshot: { label: 'Cierre Q4' },
    changes: [
      {
        field: 'display_name',
        before: { state: 'null' },
        after: { state: 'value', value: 'Cierre Q4' },
      },
    ],
  })
  assert.deepEqual((second!.payload as { changes: unknown }).changes, [
    {
      field: 'display_name',
      before: { state: 'value', value: 'Cierre Q4' },
      after: { state: 'null' },
    },
  ])
  assert.equal(second!.sequence, Number(first!.sequence) + 1)
  // Contexto de red guardado aparte (sin proxy: unknown) y la cadena verifica.
  assert.ok(first!.network_digest)
  const report = await verifyAuditChains(payload, { chainIds: [`org:${org}`] })
  assert.ok(report.ok, JSON.stringify(report.chains[0]?.error ?? report.chains[0]?.anomalies))
})

test('A095: el renombre de un reporte de escaneo emite scan.rename', async () => {
  const payload = await getPayload({ config })
  const { org, officeA, admin, viewer } = await seed(payload)
  const report = await scanReport(payload, officeA)
  const id = String(report.id)
  const call = (userId: string, body: unknown) =>
    scanReportNameEndpoint.handler(fakeRequest(payload, user(userId), id, body))

  assert.equal((await call(viewer, { display_name: 'X' })).status, 403)
  assert.equal((await call(admin, { display_name: 'Escaneo semanal' })).status, 200)
  const [written, ...rest] = await events(payload, id)
  assert.equal(rest.length, 0)
  assert.deepEqual(
    [written!.action_code, written!.entity_type, written!.entity_id, written!.actor_role],
    ['scan.rename', 'scan_report', id, 'org_admin']
  )
  assert.ok((await verifyAuditChains(payload, { chainIds: [`org:${org}`] })).ok)
})

test('A095: un PlatformAdmin de visita queda como autor platform_admin', async () => {
  const payload = await getPayload({ config })
  const { org, snapshot } = await seed(payload)
  const admin = await platformAdmin(payload)
  const id = String(snapshot.id)
  const response = await inventorySnapshotNameEndpoint.handler(
    fakeRequest(
      payload,
      { id: admin, collection: 'admins' },
      id,
      { display_name: 'Revisión de plataforma' },
      `http://localhost/api/v1/inventory-snapshots/${id}/name?asOrganization=${org}`
    )
  )
  assert.equal(response.status, 200)
  const [written] = await events(payload, id)
  assert.deepEqual(
    [
      written!.actor_type,
      written!.actor_id,
      written!.actor_collection,
      written!.actor_role,
      written!.visit_id,
    ],
    ['platform_admin', admin, 'admins', 'platform_admin', null]
  )
})

test('A095: sin auditoría no hay cambio (faltan las claves al cerrar)', async () => {
  const payload = await getPayload({ config })
  const { snapshot, admin } = await seed(payload)
  const id = String(snapshot.id)
  const saved = process.env.AUDIT_HMAC_KEYS
  try {
    delete process.env.AUDIT_HMAC_KEYS
    resetAuditKeysCache()
    await assert.rejects(
      async () =>
        inventorySnapshotNameEndpoint.handler(
          fakeRequest(payload, user(admin), id, { display_name: 'No debería quedar' })
        ),
      /AuditLog: las claves no están configuradas/
    )
  } finally {
    process.env.AUDIT_HMAC_KEYS = saved
    resetAuditKeysCache()
  }
  const reloaded = await payload.findByID({
    collection: 'inventory-snapshots',
    id,
    overrideAccess: true,
  })
  assert.equal(reloaded.display_name ?? null, null, 'el renombre se revirtió')
  assert.deepEqual(await events(payload, id), [])
})
