import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { officeAgentSummaryEndpoint } from './officeAgentSummary'

// Mismo enfoque que assetIdentify.integration.test.ts (Local API real + PayloadRequest mínimo).
function fakeRequest(payload: Payload, opts: { user?: { id: string; collection: 'users' } }) {
  return {
    payload,
    user: opts.user,
    context: {},
  } as unknown as PayloadRequest
}

async function seedTenant(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Test', is_active: true },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'agents',
    data: {
      id: `agent-${Math.random().toString(36).slice(2)}`,
      office: office.id,
      is_active: true,
      last_heartbeat_at: new Date().toISOString(),
    },
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
      data: { slug: 'org_admin', name: 'org_admin', rank: 2, scope: 'organization', is_platform_role: false },
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
      offices: [office.id],
      role: role.id,
      status: 'active',
      is_active: true,
    },
    overrideAccess: true,
  })
  return { organization, office, user }
}

test('GET /v1/offices/agent-summary: 401 sin sesión', async () => {
  const payload = await getPayload({ config })
  const res = await officeAgentSummaryEndpoint.handler(fakeRequest(payload, {}))
  assert.equal(res.status, 401)
})

test('GET /v1/offices/agent-summary: 200 resume agentes solo de las offices en alcance del usuario', async () => {
  const payload = await getPayload({ config })
  const { office, user } = await seedTenant(payload)

  const res = await officeAgentSummaryEndpoint.handler(
    fakeRequest(payload, { user: { id: String(user.id), collection: 'users' } }),
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.docs.length, 1)
  assert.equal(body.docs[0].office_id, String(office.id))
  assert.equal(body.docs[0].online, 1)
})
