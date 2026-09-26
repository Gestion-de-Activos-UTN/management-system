import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import config from '../../payload.config'
import { recalculateRisk } from './recalculateRisk'
import { manualResult, seedRiskOrganization } from './risk-integration-seed'

// Integration test against Postgres: the pure engine is covered by unit tests; this checks the
// loader (queries, pagination, aging, tenant filtering) and the transactional persistence.

test('recalculateRisk: persists every applicable pair, applies aging and catalog severity', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const ids = {
    organizationId: String(organization.id),
    officeId: String(office.id),
    assetId: String(server.id),
  }
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(ids, 'A.8.2', 0, future),
  })
  // Expired answer: must not revive A.8.13 (aging, plan §3.10).
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(ids, 'A.8.13', 1, past),
  })
  // Another tenant with an asset and an answer that must never leak into this evaluation.
  const other = await seedRiskOrganization(payload)
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(
      {
        organizationId: String(other.organization.id),
        officeId: String(other.office.id),
        assetId: String(other.server.id),
      },
      'A.8.2',
      1,
      future
    ),
  })

  const evaluation = await recalculateRisk(payload, { organizationId: ids.organizationId })

  const contributions = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 500,
    where: { evaluation: { equals: evaluation.id } },
  })
  // Server under essential policy: 5 automatic + 9 question controls (see reference fixtures).
  assert.equal(contributions.totalDocs, 14)
  assert.ok(contributions.docs.every(row => row.asset_key === `asset:${ids.assetId}`))

  const byControl = new Map(contributions.docs.map(row => [row.control_key, row]))
  const privileged = byControl.get('A.8.2')!
  assert.equal(privileged.severity, 'critical')
  assert.equal(privileged.status, 'non_compliant')
  assert.equal(privileged.inherent_risk, 64) // C=8 × A=1 × S=8 × X=1
  assert.equal(privileged.residual_risk, 64)
  assert.equal(byControl.get('A.8.13')!.status, 'not_evaluable')
  assert.equal(byControl.get('A.8.16')!.status, 'compliant')
  assert.equal(byControl.get('A.8.13')!.exposure_source, 'scan')

  assert.equal(evaluation.policy_key, 'essential')
  const alerts = evaluation.alerts as { critical_assets: unknown[] }
  assert.deepEqual(alerts.critical_assets, [
    { asset_id: `asset:${ids.assetId}`, control_key: 'A.8.2' },
  ])
})

test('recalculateRisk: an office evaluation still inherits organization-level answers', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      ...manualResult(
        {
          organizationId: String(organization.id),
          officeId: String(office.id),
          assetId: String(server.id),
        },
        'A.5.25',
        1,
        new Date(Date.now() + 86_400_000).toISOString()
      ),
      office: null,
      asset: null,
    },
  })

  const evaluation = await recalculateRisk(payload, {
    organizationId: String(organization.id),
    officeId: String(office.id),
  })
  const events = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: {
      and: [{ evaluation: { equals: evaluation.id } }, { control_key: { equals: 'A.5.25' } }],
    },
  })
  assert.equal(events.docs[0]?.status, 'compliant')
})

test('recalculateRisk: ignores answers from another policy and stamps the evidence read time', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const ids = {
    organizationId: String(organization.id),
    officeId: String(office.id),
    assetId: String(server.id),
  }
  // Answered under reinforced, then the organization moved to essential (seed): must not count.
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      ...manualResult(ids, 'A.8.2', 1, new Date(Date.now() + 86_400_000).toISOString()),
      policy_key: 'reinforced',
    },
  })
  const now = new Date(Date.now() - 60_000)

  const evaluation = await recalculateRisk(payload, { organizationId: ids.organizationId, now })

  assert.equal(new Date(evaluation.evaluated_at).getTime(), now.getTime())
  const privileged = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: {
      and: [{ evaluation: { equals: evaluation.id } }, { control_key: { equals: 'A.8.2' } }],
    },
  })
  assert.equal(privileged.docs[0]?.status, 'not_evaluable')
})
