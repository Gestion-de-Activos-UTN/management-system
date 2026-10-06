import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AssessmentInstance, Asset } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canAnswerAssessment, canReadAssessment } from './assessmentAccess'

const assessment = {
  organization: 'org-1',
  office: 'office-1',
  scope: 'asset',
} as AssessmentInstance
const ctx = (role: TenantContext['role'], officeIds = ['office-1']): TenantContext => ({
  userId: 'user-1',
  role,
  organizationId: 'org-1',
  officeIds,
  selectedOfficeId: null,
  isPlatformAdmin: role === 'platform_admin',
  isActive: true,
})

describe('assessment write access', () => {
  it('allows org admin and scoped office manager', () => {
    assert.equal(canAnswerAssessment(ctx('org_admin'), assessment), true)
    assert.equal(canAnswerAssessment(ctx('office_manager'), assessment), true)
    assert.equal(canAnswerAssessment(ctx('office_manager', []), assessment), false)
  })

  it('allows a viewer only for an asset they own', () => {
    assert.equal(
      canAnswerAssessment(ctx('org_viewer'), assessment, { owner: 'user-1' } as Asset),
      true
    )
    assert.equal(
      canAnswerAssessment(ctx('org_viewer'), assessment, { owner: 'user-2' } as Asset),
      false
    )
  })

  it('keeps platform visits read-only', () => {
    assert.equal(canAnswerAssessment(ctx('platform_admin'), assessment), false)
  })
})

describe('assessment read access', () => {
  const organizationCycle = {
    organization: 'org-1',
    office: null,
    scope: 'organization',
  } as AssessmentInstance

  it('shows organization-level cycles only to org-wide roles', () => {
    assert.equal(canReadAssessment(ctx('org_admin'), organizationCycle), true)
    assert.equal(canReadAssessment(ctx('office_manager'), organizationCycle), false)
    assert.equal(canReadAssessment(ctx('org_viewer'), organizationCycle), false)
  })

  it('keeps office and asset cycles readable inside the caller offices', () => {
    assert.equal(canReadAssessment(ctx('org_viewer'), assessment), true)
    assert.equal(canReadAssessment(ctx('office_manager', ['office-2']), assessment), false)
  })
})
