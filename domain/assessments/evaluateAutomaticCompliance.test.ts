import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateAssetFacts,
  evaluateOfficeMonitoring,
  reevaluateComplianceAfterScan,
} from './evaluateAutomaticCompliance'

describe('automatic compliance checks', () => {
  it('uses known inventory fields without turning missing data into failure', () => {
    const missing = evaluateAssetFacts({
      identified: true,
      owner: null,
      criticality: null,
      authorization_status: 'pending',
    })
    assert.deepEqual(
      missing.map(check => check.status),
      ['not_evaluable', 'not_evaluable', 'not_evaluable']
    )
    const unauthorized = evaluateAssetFacts({
      identified: true,
      owner: 'user-1',
      criticality: 'high',
      authorization_status: 'unauthorized',
    })
    assert.equal(
      unauthorized.find(check => check.control_key === 'A.8.20')?.status,
      'non_compliant'
    )
  })

  it('distinguishes absent visibility from a scanner that stopped reporting', () => {
    const now = new Date('2026-01-01T00:10:00Z')
    assert.equal(evaluateOfficeMonitoring([], now).status, 'not_evaluable')
    assert.equal(
      evaluateOfficeMonitoring(
        [{ id: 'agent-1', lifecycle_status: 'active', last_heartbeat_at: '2026-01-01T00:00:00Z' }],
        now
      ).status,
      'compliant'
    )
    assert.equal(
      evaluateOfficeMonitoring(
        [{ id: 'agent-1', lifecycle_status: 'active', last_heartbeat_at: '2025-12-31T23:00:00Z' }],
        now
      ).status,
      'non_compliant'
    )
  })

  it('loads scan targets only for the currently selected policy version', async () => {
    let assessmentWhere: unknown
    const payload = {
      find: async ({ collection, where }: { collection: string; where?: unknown }) => {
        if (collection === 'organization-settings')
          return {
            docs: [{ assessment_policy_key: 'reinforced', assessment_policy_version: 2 }],
          }
        if (collection === 'subscriptions')
          return { docs: [{ features: { security_assessments: true } }] }
        if (collection === 'assessment-instances') {
          assessmentWhere = where
          return { docs: [] }
        }
        throw new Error(`Unexpected collection ${collection}`)
      },
    }

    await reevaluateComplianceAfterScan(
      payload as never,
      'org-1',
      'office-1',
      [],
      undefined,
      new Date('2026-01-01T00:00:00Z')
    )

    assert.deepEqual(assessmentWhere, {
      and: [
        { organization: { equals: 'org-1' } },
        { policy_key: { equals: 'reinforced' } },
        { policy_version: { equals: 2 } },
        {
          or: [
            { office: { equals: 'office-1' }, scope: { equals: 'office' } },
            { asset: { in: [] }, scope: { equals: 'asset' } },
          ],
        },
      ],
    })
  })
})
