import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { inventorySnapshotNameEndpoint } from './evidenceNames'
import { createInventorySnapshot } from '../domain/inventories/createInventorySnapshot'

// Mismo enfoque que nonNetworkAssetReview.integration.test.ts (Local API real + PayloadRequest mínimo).
function fakeRequest(payload: Payload, userId: string, id: string, body: unknown) {
  return {
    payload,
    user: { id: userId, collection: 'users' },
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

async function seed(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
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
  const org = String(organization.id)
  return {
    snapshot,
    admin: await member(payload, org, [String(officeA.id), String(officeB.id)], 'org_admin'),
    managerA: await member(payload, org, [String(officeA.id)], 'office_manager'),
    managerB: await member(payload, org, [String(officeB.id)], 'office_manager'),
    viewer: await member(payload, org, [String(officeA.id)], 'org_viewer'),
  }
}

test('PATCH /v1/inventory-snapshots/:id/name: renombra sin tocar la evidencia y respeta el alcance', async () => {
  const payload = await getPayload({ config })
  const { snapshot, admin, managerA, managerB, viewer } = await seed(payload)
  const id = String(snapshot.id)
  const call = (userId: string, body: unknown) =>
    inventorySnapshotNameEndpoint.handler(fakeRequest(payload, userId, id, body))

  // Sin 'update' en la matriz: 403.
  assert.equal((await call(viewer, { display_name: 'X' })).status, 403)
  // Office manager de otra oficina: fuera de alcance.
  await assert.rejects(async () => call(managerB, { display_name: 'X' }), { status: 403 })
  // Demasiado largo: 400.
  assert.equal((await call(admin, { display_name: 'x'.repeat(81) })).status, 400)

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
