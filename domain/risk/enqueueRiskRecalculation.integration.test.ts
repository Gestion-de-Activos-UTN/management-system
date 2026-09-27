import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import config from '../../payload.config'
import { enqueueRiskRecalculation } from './enqueueRiskRecalculation'
import { seedRiskOrganization } from './risk-integration-seed'

test('enqueueRiskRecalculation: a burst of events leaves at most one pending run per scope', async () => {
  const previous = process.env.PAYLOAD_DISABLE_JOBS
  delete process.env.PAYLOAD_DISABLE_JOBS
  const payload = await getPayload({ config })
  const { organization, office } = await seedRiskOrganization(payload)
  const organizationId = String(organization.id)
  const byOrganization = { 'input.organization_id': { equals: organizationId } }
  try {
    for (let i = 0; i < 5; i += 1)
      await enqueueRiskRecalculation(payload, organizationId, [String(office.id)])

    const jobs = await payload.find({
      collection: 'payload-jobs',
      where: byOrganization,
      overrideAccess: true,
      limit: 50,
    })
    const perKey = new Map<string, number>()
    for (const job of jobs.docs)
      perKey.set(String(job.concurrencyKey), (perKey.get(String(job.concurrencyKey)) ?? 0) + 1)
    assert.deepEqual(
      [...perKey.keys()].sort(),
      [`risk:${organizationId}:${office.id}`, `risk:${organizationId}:org`].sort()
    )
    // One pending (superseded on each event), plus at most one already picked up by autoRun.
    assert.ok([...perKey.values()].every(count => count <= 2))
  } finally {
    await payload.delete({
      collection: 'payload-jobs',
      where: byOrganization,
      overrideAccess: true,
    })
    if (previous !== undefined) process.env.PAYLOAD_DISABLE_JOBS = previous
  }
})
