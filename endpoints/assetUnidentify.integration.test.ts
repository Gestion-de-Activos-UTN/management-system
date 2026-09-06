import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { assetUnidentifyEndpoint } from './assetUnidentify'

// Mismo enfoque que assetIdentify.integration.test.ts (Local API real + PayloadRequest mínimo).
function fakeRequest(
  payload: Payload,
  opts: {
    user?: { id: string; collection: 'users' }
    routeParams?: Record<string, string>
  }
) {
  return {
    payload,
    user: opts.user,
    context: {},
    routeParams: opts.routeParams ?? {},
    json: async () => ({}),
  } as unknown as PayloadRequest
}

async function seedIdentifiedAsset(payload: Payload) {
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
  const existingRole = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'org_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    existingRole.docs[0] ??
    (await payload.create({
      collection: 'roles',
      data: {
        slug: 'org_admin',
        name: 'org_admin',
        rank: 2,
        scope: 'organization',
        is_platform_role: false,
      },
      overrideAccess: true,
    }))
  const user = await payload.create({
    collection: 'users',
    data: {
      name: 'Test User',
      email: `u-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'x'.repeat(12),
    },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-memberships',
    data: {
      user: user.id,
      organization: organization.id,
      offices: [office.id],
      role: role.id,
      status: 'active',
      is_active: true,
    },
    overrideAccess: true,
  })
  const created = await payload.create({
    collection: 'assets',
    data: {
      asset_id: `a-${Math.random().toString(36).slice(2)}`,
      agent: agent.id,
      office: office.id,
      organization: organization.id,
    },
    overrideAccess: true,
    // Simula el único creador real (ingestScanReport.ts) — ver rejectBusinessEditsBeforeIdentified.ts.
    context: { systemJob: true },
  })
  // Update separado, no en el create: validateOwnerTenant lee `organization` de `originalDoc`
  // (no existe todavía en el create), mismo motivo por el que assetIdentify.ts solo pisa `owner`
  // en un PATCH sobre un asset ya creado por ingestScanReport.
  const asset = await payload.update({
    collection: 'assets',
    id: created.id,
    overrideAccess: true,
    data: {
      identified: true,
      identification_status: 'confirmed',
      confirmed_type: 'workstation',
      authorization_status: 'authorized',
      owner: user.id,
      criticality: 'high',
      alias: 'Mi PC',
    },
  })
  return { organization, office, asset, user }
}

test('PATCH /v1/assets/:id/unidentify: 401 sin sesión', async () => {
  const payload = await getPayload({ config })
  const { asset } = await seedIdentifiedAsset(payload)

  const res = await assetUnidentifyEndpoint.handler(
    fakeRequest(payload, { routeParams: { id: String(asset.id) } })
  )
  assert.equal(res.status, 401)
})

test('PATCH /v1/assets/:id/unidentify: vuelve a pending sin borrar owner/criticality/alias', async () => {
  const payload = await getPayload({ config })
  const { asset, user } = await seedIdentifiedAsset(payload)

  const res = await assetUnidentifyEndpoint.handler(
    fakeRequest(payload, {
      user: { id: String(user.id), collection: 'users' },
      routeParams: { id: String(asset.id) },
    })
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.identified, false)
  assert.equal(body.identification_status, 'pending')
  // El bloque de negocio queda guardado para prepopular si se vuelve a identificar.
  assert.equal(body.criticality, 'high')
  assert.equal(body.alias, 'Mi PC')
})
