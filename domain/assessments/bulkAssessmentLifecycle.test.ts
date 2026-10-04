import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentInstance, Asset } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { questionSetSignature, resolveBulkAssessmentPreview } from './bulkAssessmentLifecycle'

describe('bulk assessment question-set signature', () => {
  it('is stable when the frozen questions arrive in a different order', () => {
    const first = [
      { key: 'q.two', version: 2 },
      { key: 'q.one', version: 1 },
    ]
    const second = [...first].reverse()
    assert.equal(questionSetSignature(first), 'q.one@1|q.two@2')
    assert.equal(questionSetSignature(first), questionSetSignature(second))
  })

  it('changes when a question version changes and ignores malformed rows', () => {
    assert.notEqual(
      questionSetSignature([{ key: 'q.one', version: 1 }]),
      questionSetSignature([{ key: 'q.one', version: 2 }])
    )
    assert.equal(questionSetSignature([null, {}, { key: 'q.one', version: 1 }]), 'q.one@1')
  })
})

describe('bulk assessment preview', () => {
  it('selects open cycles, preserves completed-only targets and ignores superseded-only targets', async () => {
    const snapshot = [{ key: 'q.one', version: 2 }]
    const cycle = (
      id: string,
      asset: string,
      status: AssessmentInstance['status'],
      createdAt: string
    ) =>
      ({
        id,
        organization: 'org-1',
        office: 'office-1',
        asset,
        scope: 'asset',
        status,
        policy_key: 'essential',
        policy_version: 2,
        catalog_version: 2,
        question_set_snapshot: snapshot,
        createdAt,
      }) as AssessmentInstance
    const instances = [
      cycle('open-1', 'asset-1', 'in_progress', '2026-04-04T00:00:00.000Z'),
      cycle('closed-2', 'asset-2', 'completed', '2026-04-03T00:00:00.000Z'),
      cycle('open-3', 'asset-3', 'pending', '2026-04-02T00:00:00.000Z'),
      cycle('closed-3', 'asset-3', 'completed', '2026-04-01T00:00:00.000Z'),
      cycle('superseded-4', 'asset-4', 'superseded', '2026-03-31T00:00:00.000Z'),
    ]
    const assets = ['asset-1', 'asset-2', 'asset-3', 'asset-4'].map(
      id =>
        ({
          id,
          organization: 'org-1',
          office: 'office-1',
          owner: 'user-1',
          alias: id,
          identified: true,
          confirmed_type: 'workstation',
          status: 'active',
        }) as Asset
    )
    const payload = {
      find: async ({ collection }: { collection: string }) => {
        if (collection === 'assessment-instances') return { docs: instances }
        if (collection === 'assets') return { docs: assets }
        if (collection === 'non-network-assets') return { docs: [] }
        if (collection === 'assessment-answers') return { docs: [{ assessment: 'open-1' }] }
        throw new Error(`Unexpected collection ${collection}`)
      },
    } as unknown as Payload
    const ctx: TenantContext = {
      userId: 'user-1',
      role: 'org_admin',
      organizationId: 'org-1',
      officeIds: ['office-1'],
      selectedOfficeId: 'office-1',
      isPlatformAdmin: false,
      isActive: true,
    }

    const preview = await resolveBulkAssessmentPreview(
      payload,
      ctx,
      { mode: 'organization', risk_asset_type: 'workstation' },
      {} as PayloadRequest
    )

    assert.deepEqual(
      preview.applicable.map(item => [item.assessment_id, item.has_draft]),
      [
        ['open-1', true],
        ['open-3', false],
      ]
    )
    assert.deepEqual(
      preview.preserved_completed.map(item => item.assessment_id),
      ['closed-2']
    )
  })
})
