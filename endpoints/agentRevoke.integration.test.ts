import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { agentRevokeEndpoint } from './agentRevoke'

function fakeRequest(
  payload: Payload,
  opts: {
    user?: { id: string; collection: 'users' }
    id: string
  }
) {
  return {
    payload,
    user: opts.user,
    context: {},
    routeParams: { id: opts.id },
  } as unknown as PayloadRequest
}

async function seed(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Office' },
    overrideAccess: true,
  })
  const roleResult = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'org_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    roleResult.docs[0] ??
    (await payload.create({
      collection: 'roles',
      data: {
        slug: 'org_admin',
        name: 'Org admin',
        rank: 2,
        scope: 'organization',
        is_platform_role: false,
      },
      overrideAccess: true,
    }))
  const user = await payload.create({
    collection: 'users',
    data: {
      name: 'Admin',
      email: `agent-admin-${Math.random()}@test.local`,
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
  const agent = await payload.create({
    collection: 'agents',
    data: { id: `agent-${Math.random()}`, office: office.id, lifecycle_status: 'provisioned' },
    overrideAccess: true,
  })
  return { user, agent }
}

test('POST /v1/agents/:id/revoke: revoca de forma idempotente', async () => {
  const payload = await getPayload({ config })
  const { user, agent } = await seed(payload)
  const req = fakeRequest(payload, {
    user: { id: String(user.id), collection: 'users' },
    id: String(agent.id),
  })

  const first = await agentRevokeEndpoint.handler(req)
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  assert.equal(firstBody.lifecycle_status, 'revoked')
  assert.equal(firstBody.is_active, false)
  assert.ok(firstBody.revoked_at)

  const second = await agentRevokeEndpoint.handler(req)
  assert.equal(second.status, 200)
  assert.equal((await second.json()).lifecycle_status, 'revoked')
})
