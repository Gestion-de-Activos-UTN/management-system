import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { assetIdentifyEndpoint } from './assetIdentify'

// Mismo enfoque que reports.integration.test.ts (Local API real + PayloadRequest mínimo), pero
// la identidad acá es de un usuario humano, no un agente con API key — payloadNativeIdentityProvider
// (access/tenant/identityProvider.ts) lee `req.user` directo, así que alcanza con setearlo en el
// fake request en vez de simular cookies/JWT.
function fakeRequest(
  payload: Payload,
  opts: { user?: { id: string; collection: 'users' }; routeParams?: Record<string, string>; body?: unknown },
) {
  return {
    payload,
    user: opts.user,
    context: {},
    routeParams: opts.routeParams ?? {},
    json: async () => opts.body ?? {},
  } as unknown as PayloadRequest
}

async function seedTenant(payload: Payload, roleSlug: 'org_admin' | 'org_viewer', officeIds: string[] | 'self') {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Test' },
    overrideAccess: true,
  })
  const agent = await payload.create({
    collection: 'agents',
    data: { id: `agent-${Math.random().toString(36).slice(2)}`, office: office.id },
    overrideAccess: true,
  })
  const asset = await payload.create({
    collection: 'assets',
    data: {
      asset_id: `a-${Math.random().toString(36).slice(2)}`,
      agent: agent.id,
      office: office.id,
      organization: organization.id,
      identified: false,
    },
    overrideAccess: true,
  })
  // canDo (access/rbac/permissions.ts) indexa la matriz por el slug literal ('org_admin',
  // 'org_viewer') — Roles.slug es unique, así que se busca el existente (mismo patrón idempotente
  // que scripts/seed-navigation.ts::findOrCreateRole) en vez de crear uno nuevo con slug al azar.
  const existingRole = await payload.find({
    collection: 'roles',
    where: { slug: { equals: roleSlug } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    existingRole.docs[0] ??
    (await payload.create({
      collection: 'roles',
      data: {
        slug: roleSlug,
        name: roleSlug,
        rank: roleSlug === 'org_admin' ? 2 : 3,
        scope: 'organization',
        is_platform_role: false,
      },
      overrideAccess: true,
    }))
  const user = await payload.create({
    collection: 'users',
    data: { name: 'Test User', email: `u-${Math.random().toString(36).slice(2)}@test.local`, password: 'x'.repeat(12) },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-memberships',
    data: {
      user: user.id,
      organization: organization.id,
      offices: officeIds === 'self' ? [office.id] : officeIds,
      role: role.id,
      status: 'active',
      is_active: true,
    },
    overrideAccess: true,
  })
  return { organization, office, asset, user, roleSlug: role.slug }
}

test('PATCH /v1/assets/:id/identify: 401 sin sesión', async () => {
  const payload = await getPayload({ config })
  const { asset } = await seedTenant(payload, 'org_admin', 'self')

  const res = await assetIdentifyEndpoint.handler(
    fakeRequest(payload, { routeParams: { id: String(asset.id) }, body: { identified: true } }),
  )
  assert.equal(res.status, 401)
})

test('PATCH /v1/assets/:id/identify: 403 sin permiso de update sobre assets (org_viewer)', async () => {
  const payload = await getPayload({ config })
  const { asset, user } = await seedTenant(payload, 'org_viewer', 'self')

  const res = await assetIdentifyEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      routeParams: { id: String(asset.id) },
      body: { identified: true },
    }),
  )
  assert.equal(res.status, 403)
})

test('PATCH /v1/assets/:id/identify: rechaza (403) si la office del asset no está en el alcance del usuario', async () => {
  const payload = await getPayload({ config })
  // 'self' asignaría la office del propio asset — acá forzamos el desalineamiento pasando [].
  const { asset, user } = await seedTenant(payload, 'org_admin', [])

  await assert.rejects(
    async () => {
      await assetIdentifyEndpoint.handler(
        fakeRequest(payload, {
          user: { id: String(user.id), collection: 'users' },
          routeParams: { id: String(asset.id) },
          body: { identified: true },
        }),
      )
    },
    (e: unknown) => (e as { status?: number }).status === 403,
  )
})

test('PATCH /v1/assets/:id/identify: 200 happy path, togglea en ambas direcciones', async () => {
  const payload = await getPayload({ config })
  const { asset, user } = await seedTenant(payload, 'org_admin', 'self')

  const identifyRes = await assetIdentifyEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      routeParams: { id: String(asset.id) },
      body: { identified: true },
    }),
  )
  assert.equal(identifyRes.status, 200)
  assert.equal((await identifyRes.json()).identified, true)

  const undoRes = await assetIdentifyEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      routeParams: { id: String(asset.id) },
      body: { identified: false },
    }),
  )
  assert.equal(undoRes.status, 200)
  assert.equal((await undoRes.json()).identified, false)
})
