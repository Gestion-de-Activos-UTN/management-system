import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateComplianceResult } from './validateComplianceResult'

describe('compliance result tenant hook', () => {
  it('rejects a service result without an asset', async () => {
    await assert.rejects(
      validateComplianceResult({
        data: { organization: 'org-1', service_key: 'tcp:23' },
        req: { payload: {} },
      } as never),
      /require an asset/
    )
  })

  it('rejects an asset whose organization does not match', async () => {
    const req = {
      payload: {
        findByID: async ({ collection }: { collection: string }) =>
          collection === 'offices'
            ? { id: 'office-1', organization: 'org-1' }
            : { id: 'asset-1', organization: 'org-2', office: 'office-1' },
      },
    }
    await assert.rejects(
      validateComplianceResult({
        data: { organization: 'org-1', office: 'office-1', asset: 'asset-1' },
        req,
      } as never),
      /does not belong/
    )
  })
})
