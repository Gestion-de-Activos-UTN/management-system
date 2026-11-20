import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateComplianceResult } from './validateComplianceResult'

const docs: Record<string, Record<string, unknown>> = {
  o1: { organization: 'org-1' },
  g1: { organization: 'org-1', office: 'o1' },
  g2: { organization: 'org-1', office: 'o1' },
  previous: { organization: 'org-1', asset: 'g1', control_key: 'A.8.21', service_key: 'tcp:23' },
}
const req = { payload: { findByID: async ({ id }: { id: string }) => docs[id] } }
const run = (data: Record<string, unknown>) =>
  (validateComplianceResult as unknown as (args: unknown) => Promise<unknown>)({ data, req })
const next = { organization: 'org-1', office: 'o1', asset: 'g1', control_key: 'A.8.21', service_key: 'tcp:23', supersedes: 'previous' }

describe('validateComplianceResult — supersedes', () => {
  it('links a result of the same asset, control and service, whatever its check', async () => {
    assert.ok(await run({ ...next, check_key: 'network.service:tcp:23' }))
  })

  it('refuses to supersede another service, protocol or asset', async () => {
    for (const change of [{ service_key: 'udp:23' }, { service_key: 'tcp:24' }, { asset: 'g2' }, { control_key: 'A.8.20' }])
      await assert.rejects(run({ ...next, ...change }), /mismo activo, control y servicio/, JSON.stringify(change))
  })
})
