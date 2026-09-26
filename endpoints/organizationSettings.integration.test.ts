import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { organizationMaturityUpdateEndpoint } from './organizationSettings'

const patch = async (payload: Payload, userId: string, body: unknown) => {
  const response = await organizationMaturityUpdateEndpoint.handler({
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    json: async () => body,
  } as unknown as PayloadRequest)
  return { status: response.status, body: await response.json() }
}

test('maturity profile: only org_admin can edit it and the author is recorded', async () => {
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const orgId = String(organization.id)
  const admin = await member(payload, orgId, [String(office.id)], 'org_admin')
  const manager = await member(payload, orgId, [String(office.id)], 'office_manager')
  const valid = { maturity_it_owner: 'yes', maturity_security_budget: 'occasional' }

  assert.equal((await patch(payload, manager, valid)).status, 403)
  assert.equal((await patch(payload, admin, { maturity_it_owner: 'maybe' })).status, 400)

  const saved = await patch(payload, admin, valid)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.maturity_it_owner, 'yes')
  assert.equal(saved.body.maturity_security_budget, 'occasional')
  assert.equal(String(saved.body.maturity_updated_by), admin)
  assert.ok(saved.body.maturity_updated_at)
})
