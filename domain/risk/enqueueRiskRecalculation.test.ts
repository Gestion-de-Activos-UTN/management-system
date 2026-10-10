import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { Payload, PayloadRequest } from 'payload'
import {
  enqueueOrganizationRiskRecalculation,
  enqueueRiskRecalculation,
} from './enqueueRiskRecalculation'

function fakePayload(officeIds: string[] = []) {
  const queued: Array<{ organization_id: string; office_id?: string }> = []
  const payload = {
    db: {
      beginTransaction: async () => 'test',
      commitTransaction: async () => {},
      rollbackTransaction: async () => {},
    },
    jobs: { queue: async ({ input }: { input: (typeof queued)[number] }) => queued.push(input) },
    find: async () => ({ docs: officeIds.map(id => ({ id })) }),
  } as unknown as Payload
  const req = { payload, context: {} } as unknown as PayloadRequest
  return { payload, queued, req }
}

describe('enqueueRiskRecalculation', () => {
  const previous = process.env.PAYLOAD_DISABLE_JOBS
  beforeEach(() => delete process.env.PAYLOAD_DISABLE_JOBS)
  afterEach(() => {
    if (previous === undefined) delete process.env.PAYLOAD_DISABLE_JOBS
    else process.env.PAYLOAD_DISABLE_JOBS = previous
  })

  it('queues the organization view plus each distinct, non-empty office', async () => {
    const { payload, queued, req } = fakePayload()
    await enqueueRiskRecalculation(
      payload,
      'org-1',
      ['office-1', null, undefined, '', 'office-1', 'office-2'],
      req
    )
    assert.deepEqual(queued, [
      { organization_id: 'org-1', office_id: undefined },
      { organization_id: 'org-1', office_id: 'office-1' },
      { organization_id: 'org-1', office_id: 'office-2' },
    ])
  })

  it('organization-level events refresh every office of the organization', async () => {
    const { payload, queued, req } = fakePayload(['office-1', 'office-2'])
    await enqueueOrganizationRiskRecalculation(payload, 'org-1', req)
    assert.deepEqual(
      queued.map(item => item.office_id),
      [undefined, 'office-1', 'office-2']
    )
  })

  it('queues nothing when jobs are disabled', async () => {
    process.env.PAYLOAD_DISABLE_JOBS = '1'
    const { payload, queued, req } = fakePayload(['office-1'])
    await enqueueRiskRecalculation(payload, 'org-1', ['office-1'], req)
    await enqueueOrganizationRiskRecalculation(payload, 'org-1', req)
    assert.equal(queued.length, 0)
  })
})
