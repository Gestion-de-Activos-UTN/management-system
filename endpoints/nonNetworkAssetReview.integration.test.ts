import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { nonNetworkAssetReviewEndpoint } from './nonNetworkAssetReview'

// Mismo enfoque que assetUnidentify.integration.test.ts (Local API real + PayloadRequest mínimo).
function fakeRequest(
  payload: Payload,
  opts: { userId: string; routeParams?: Record<string, string>; context?: Record<string, unknown> }
) {
  return {
    payload,
    user: { id: opts.userId, collection: 'users' },
    context: opts.context ?? {},
    routeParams: opts.routeParams ?? {},
    json: async () => ({}),
  } as unknown as PayloadRequest
}

async function seedOverdueManualAsset(payload: Payload) {
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
  // Creado "hace 40 días" con intervalo mensual: queda vencido por la misma derivación que la UI.
  const asset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    req: fakeRequest(payload, {
      userId: String(user.id),
      context: { seedEffectiveNow: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString() },
    }),
    data: {
      alias: 'Backup diario',
      asset_category: 'server',
      criticality: 'high',
      owner: user.id,
      office: office.id,
      organization: organization.id,
      review_interval: '1m',
      status: 'active',
    },
  })
  return { asset, user }
}

test('PATCH /v1/non-network-assets/:id/review: una revisión vencida queda al día', async () => {
  const payload = await getPayload({ config })
  const { asset, user } = await seedOverdueManualAsset(payload)
  assert.equal(asset.review_status, 'overdue')

  const res = await nonNetworkAssetReviewEndpoint.handler(
    fakeRequest(payload, { userId: String(user.id), routeParams: { id: String(asset.id) } })
  )
  assert.equal(res.status, 200)

  const reloaded = await payload.findByID({
    collection: 'non-network-assets',
    id: asset.id,
    overrideAccess: true,
  })
  assert.ok(reloaded.last_reviewed_at)
  assert.ok(Date.parse(String(reloaded.next_review_at)) > Date.now())
  assert.equal(reloaded.review_status, 'ok')
})
