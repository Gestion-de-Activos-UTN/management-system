import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAssessmentOfficeScope } from './assessments'

describe('assessment office filtering', () => {
  it('uses current asset relations instead of the office frozen in historical cycles', () => {
    const scope = buildAssessmentOfficeScope('office-2', ['asset-current'], ['manual-current']) as {
      or: Array<Record<string, unknown>>
    }

    assert.deepEqual(scope.or, [
      { scope: { equals: 'organization' } },
      {
        and: [{ scope: { equals: 'office' } }, { office: { equals: 'office-2' } }],
      },
      {
        and: [{ scope: { equals: 'asset' } }, { asset: { in: ['asset-current'] } }],
      },
      {
        and: [{ scope: { equals: 'asset' } }, { manual_asset: { in: ['manual-current'] } }],
      },
    ])
    assert.equal(JSON.stringify(scope).includes('office-1'), false)
  })

  it('does not add a broad device branch when the office has no current assets', () => {
    const scope = buildAssessmentOfficeScope('office-empty', [], []) as {
      or: Array<Record<string, unknown>>
    }
    assert.equal(scope.or.length, 2)
  })
})
