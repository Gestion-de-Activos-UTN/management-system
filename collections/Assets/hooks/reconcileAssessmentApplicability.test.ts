import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset } from '@/app/types/payload-types'
import { assetAssessmentApplicabilityChanged } from './reconcileAssessmentApplicability'

const workstation = {
  id: 'asset-1',
  organization: 'org-1',
  office: 'office-1',
  status: 'active',
  identified: true,
  identification_status: 'confirmed',
  confirmed_type: 'workstation',
  alias: 'Office PC',
  criticality: 'medium',
  owner: 'user-1',
} as Asset

describe('scanned asset assessment applicability changes', () => {
  it('ignores descriptive and business-data changes', () => {
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, alias: 'Renamed PC', criticality: 'high', owner: 'user-2' },
        workstation,
        'update'
      ),
      false
    )
  })

  it('reacts to confirmed category, retirement and assessment-scope changes', () => {
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, confirmed_type: 'gateway' },
        workstation,
        'update'
      ),
      true
    )
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, status: 'retired' },
        workstation,
        'update'
      ),
      true
    )
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, assessment_scope: 'excluded' },
        workstation,
        'update'
      ),
      true
    )
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, status: 'offline' },
        workstation,
        'update'
      ),
      false
    )
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, identification_status: 'needs_review' },
        workstation,
        'update'
      ),
      false
    )
    assert.equal(
      assetAssessmentApplicabilityChanged(
        { ...workstation, office: 'office-2' },
        workstation,
        'update'
      ),
      false
    )
  })
})
