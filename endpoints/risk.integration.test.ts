import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import type { LatestRiskResponse } from '@/modules/risk/service'
import { latestRiskEvaluationEndpoint } from './risk'

// IDOR checks: the organization always comes from the membership, never from the request, and
// an office outside the membership is rejected even inside the same organization.

const call = async (payload: Payload, userId: string, query = '') => {
  const response = await latestRiskEvaluationEndpoint.handler({
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    url: `http://localhost/api/v1/risk/latest${query}`,
  } as unknown as PayloadRequest)
  return { status: response.status, body: (await response.json()) as LatestRiskResponse }
}

test('risk endpoint: never returns another organization or an office outside the membership', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const b = await seedRiskOrganization(payload)
  const orgA = String(a.organization.id)
  const officeA1 = String(a.office.id)
  const officeA2 = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { organization: orgA, name: 'Second' },
      })
    ).id
  )
  const officeB = String(b.office.id)
  await recalculateRisk(payload, { organizationId: orgA })
  await recalculateRisk(payload, { organizationId: orgA, officeId: officeA1 })
  const evaluationB = await recalculateRisk(payload, { organizationId: String(b.organization.id) })

  const admin = await member(payload, orgA, [officeA1, officeA2], 'org_admin')
  const manager = await member(payload, orgA, [officeA1], 'office_manager')

  // Another tenant's office id is rejected, not silently answered with own data.
  assert.equal((await call(payload, admin, `?office_id=${officeB}`)).status, 403)
  // Same organization, office outside the membership.
  assert.equal((await call(payload, manager, `?office_id=${officeA2}`)).status, 403)
  // A client-supplied organization never overrides the membership.
  const spoofed = await call(payload, admin, `?organization=${b.organization.id}`)
  assert.equal(spoofed.status, 200)
  assert.notEqual(spoofed.body.evaluation?.id, String(evaluationB.id))

  const own = await call(payload, admin)
  assert.equal(own.status, 200)
  assert.ok(own.body.evaluation)
  assert.ok(own.body.contributions.length > 0)
  assert.ok(own.body.contributions.every(row => row.asset_key === `asset:${a.server.id}`))
  // Labels are resolved only inside the caller's organization.
  assert.ok(own.body.contributions.every(row => row.asset_label === '10.0.0.10'))
  assert.deepEqual(
    own.body.evaluation!.top_assets.map(item => item.asset_id),
    [`asset:${a.server.id}`]
  )

  const office = await call(payload, manager, `?office_id=${officeA1}`)
  assert.equal(office.status, 200)
  assert.ok(office.body.evaluation)
})

test('risk endpoint: rejects invalid pagination instead of guessing', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const admin = await member(payload, String(a.organization.id), [String(a.office.id)], 'org_admin')
  assert.equal((await call(payload, admin, '?page=0')).status, 400)
  assert.equal((await call(payload, admin, '?page=abc')).status, 400)
})
