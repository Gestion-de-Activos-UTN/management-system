import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { manualAssessmentApplicabilityChanged } from './reconcileAssessmentApplicability'

const computer = {
  id: 'manual-1',
  alias: 'Front desk computer',
  asset_category: 'computer',
  criticality: 'medium',
  owner: 'user-1',
  office: 'office-1',
  organization: 'org-1',
  status: 'active',
  review_interval: 'never',
} as NonNetworkAsset

describe('manual asset assessment applicability changes', () => {
  it('ignores review frequency and descriptive changes', () => {
    assert.equal(
      manualAssessmentApplicabilityChanged(
        { ...computer, review_interval: '1m', alias: 'Reception PC' },
        computer,
        'update'
      ),
      false
    )
    assert.equal(
      manualAssessmentApplicabilityChanged(
        { ...computer, criticality: 'high', owner: 'user-2' },
        computer,
        'update'
      ),
      false
    )
  })

  it('reacts to category, lifecycle and target changes', () => {
    assert.equal(
      manualAssessmentApplicabilityChanged(
        { ...computer, asset_category: 'mobile_device' },
        computer,
        'update'
      ),
      true
    )
    assert.equal(
      manualAssessmentApplicabilityChanged({ ...computer, status: 'retired' }, computer, 'update'),
      true
    )
    assert.equal(
      manualAssessmentApplicabilityChanged({ ...computer, office: 'office-2' }, computer, 'update'),
      true
    )
  })
})
