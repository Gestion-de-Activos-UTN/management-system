import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateAssessmentInstance } from './validateAssessmentInstance'

const baseData = {
  organization: 'org-1',
  scope: 'office',
  office: 'office-1',
  policy_key: 'essential',
  policy_version: 1,
  catalog_version: 1,
  status: 'pending',
}

function requestWithOffice(organization: string) {
  return {
    payload: {
      findByID: async ({ collection }: { collection: string }) => {
        assert.equal(collection, 'offices')
        return { id: 'office-1', organization }
      },
      find: async () => ({ docs: [] }),
    },
  }
}

describe('assessment instance tenant hook', () => {
  it('accepts an office from the same organization', async () => {
    await assert.doesNotReject(
      validateAssessmentInstance({
        data: baseData,
        operation: 'create',
        req: requestWithOffice('org-1'),
      } as never)
    )
  })

  it('rejects an office from another organization', async () => {
    await assert.rejects(
      validateAssessmentInstance({
        data: baseData,
        operation: 'create',
        req: requestWithOffice('org-2'),
      } as never),
      /another organization/
    )
  })

  it('rejects changes to a completed instance', async () => {
    await assert.rejects(
      validateAssessmentInstance({
        data: { status: 'completed' },
        originalDoc: { ...baseData, status: 'completed' },
        operation: 'update',
        req: requestWithOffice('org-1'),
      } as never),
      /immutable/
    )
  })

  it('allows reconciliation to supersede a cycle after its asset is retired', async () => {
    const assetAssessment = {
      ...baseData,
      scope: 'asset',
      asset: 'asset-1',
      status: 'pending',
    }
    const req = {
      payload: {
        findByID: async ({ collection }: { collection: string }) =>
          collection === 'offices'
            ? { id: 'office-1', organization: 'org-1' }
            : {
                id: 'asset-1',
                organization: 'org-1',
                office: 'office-1',
                status: 'retired',
              },
        find: async () => ({ docs: [] }),
      },
    }

    await assert.doesNotReject(
      validateAssessmentInstance({
        data: { status: 'superseded' },
        originalDoc: assetAssessment,
        operation: 'update',
        req,
      } as never)
    )
  })
})
