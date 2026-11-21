import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateComplianceResult } from './validateComplianceResult'

const docs: Record<string, Record<string, unknown>> = {
  o1: { organization: 'org-1' },
  g1: { organization: 'org-1', office: 'o1' },
  g2: { organization: 'org-1', office: 'o1' },
  previous: { organization: 'org-1', asset: 'g1', control_key: 'A.8.21', service_key: 'tcp:23' },
  o2: { organization: 'org-2' },
  gx: { organization: 'org-2', office: 'o1' },
  foreign: { organization: 'org-2', asset: 'g1', control_key: 'A.8.21', service_key: 'tcp:23' },
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

describe('validateComplianceResult — tenant guards', () => {
  it('rejects a service result without an asset', async () => {
    await assert.rejects(run({ organization: 'org-1', service_key: 'tcp:23' }), /requieren un activo/)
  })

  it('rejects an office from another organization', async () => {
    await assert.rejects(run({ organization: 'org-1', office: 'o2' }), /pertenece a otra organización/)
  })

  it('rejects an asset whose organization does not match', async () => {
    await assert.rejects(
      run({ organization: 'org-1', office: 'o1', asset: 'gx' }),
      /no pertenece a su organización y oficina/
    )
  })

  it("refuses to supersede another organization's result", async () => {
    await assert.rejects(run({ ...next, supersedes: 'foreign' }), /reemplazar el de otra organización/)
  })
})
