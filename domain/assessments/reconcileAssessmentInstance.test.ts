import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Payload } from 'payload'
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types'
import {
  reconcileAssetAssessmentInstance,
  reconcileManualAssetAssessmentInstance,
  syncAssetAssessmentAssignee,
  syncManualAssetAssessmentAssignee,
} from './reconcileAssessmentInstance'

const workstation = {
  id: 'asset-1',
  organization: 'org-1',
  office: 'office-1',
  status: 'active',
  identified: true,
  identification_status: 'confirmed',
  confirmed_type: 'workstation',
} as Asset

const manualComputer = {
  id: 'manual-1',
  organization: 'org-1',
  office: 'office-1',
  owner: 'user-1',
  status: 'active',
  asset_category: 'computer',
} as NonNetworkAsset

function makePayload(openDocs: Array<Record<string, unknown>> = []) {
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  const payload = {
    async find({ collection }: { collection: string }) {
      if (collection === 'organization-settings') {
        return { docs: [{ assessment_policy_key: 'essential', assessment_policy_version: 2 }] }
      }
      if (collection === 'subscriptions') {
        return { docs: [{ features: { security_assessments: true } }] }
      }
      return { docs: openDocs }
    },
    async create({ data }: { data: Record<string, unknown> }) {
      creates.push(data)
      return { id: 'assessment-new', ...data }
    },
    async update(args: Record<string, unknown>) {
      updates.push(args)
      return { id: args.id }
    },
  } as unknown as Payload
  return { payload, creates, updates }
}

describe('asset assessment reconciliation', () => {
  it('creates the seven everyday workstation questions', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileAssetAssessmentInstance(payload, workstation, 'asset_identified')
    assert.equal(result.action, 'created')
    const snapshot = creates[0].question_set_snapshot as Array<{ key: string }>
    assert.equal(snapshot.length, 9)
    assert.equal(
      snapshot.some(question => question.key.startsWith('network.')),
      false
    )
  })

  it('creates the gateway questions from the v2 applicability table', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileAssetAssessmentInstance(
      payload,
      { ...workstation, confirmed_type: 'gateway' } as Asset,
      'asset_identified'
    )
    assert.equal(result.action, 'created')
    assert.equal((creates[0].question_set_snapshot as unknown[]).length, 3)
  })

  it('does not create questions for an excluded workstation', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileAssetAssessmentInstance(
      payload,
      { ...workstation, assessment_scope: 'excluded' } as Asset,
      'asset_identified'
    )
    assert.equal(result.action, 'none')
    assert.equal(creates.length, 0)
  })

  it('preserves an identical open cycle and supersedes an inapplicable one', async () => {
    const question_set_snapshot = [
      'A.7.9.physical_protection',
      'A.7.9.remote_actions',
      'A.8.1.exclusive_use',
      'A.8.5.unlock',
      'A.8.5.idle_lock',
      'A.8.7.protection_active',
      'A.8.7.protection_updates',
      'A.8.13.backup',
      'A.8.19.software_installation',
    ].map(key => ({ key, version: 2 }))
    const existing = {
      id: 'assessment-1',
      organization: 'org-1',
      office: 'office-1',
      policy_key: 'essential',
      policy_version: 2,
      question_set_snapshot,
    }
    const preserved = makePayload([existing])
    assert.equal(
      (await reconcileAssetAssessmentInstance(preserved.payload, workstation, 'asset_identified'))
        .action,
      'preserved'
    )
    assert.equal(preserved.updates.length, 0)

    const superseded = makePayload([existing])
    const result = await reconcileAssetAssessmentInstance(
      superseded.payload,
      { ...workstation, identified: false, identification_status: 'pending' } as Asset,
      'asset_identified'
    )
    assert.equal(result.action, 'superseded')
    assert.equal((superseded.updates[0].data as { status: string }).status, 'superseded')
  })

  it('fails closed when the subscription disables assessments', async () => {
    const setup = makePayload()
    setup.payload.find = (async ({ collection }: { collection: string }) =>
      collection === 'organization-settings'
        ? { docs: [{ assessment_policy_key: 'essential', assessment_policy_version: 2 }] }
        : collection === 'subscriptions'
          ? { docs: [{ features: { security_assessments: false } }] }
          : { docs: [] }) as Payload['find']
    assert.equal(
      (await reconcileAssetAssessmentInstance(setup.payload, workstation, 'asset_identified'))
        .action,
      'none'
    )
    assert.equal(setup.creates.length, 0)
  })
})

describe('manually entered computer assessment reconciliation', () => {
  it('creates the workstation questionnaire without scanner-specific questions', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileManualAssetAssessmentInstance(
      payload,
      manualComputer,
      'asset_identified'
    )
    assert.equal(result.action, 'created')
    assert.equal(creates[0].manual_asset, 'manual-1')
    assert.equal(creates[0].asset, null)
    assert.equal(creates[0].assigned_to, 'user-1')
    const snapshot = creates[0].question_set_snapshot as Array<{ key: string }>
    assert.equal(snapshot.length, 9)
    assert.equal(
      snapshot.some(question => question.key.startsWith('network.')),
      false
    )
  })

  it('creates the applicable v2 review for a manual mobile device', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileManualAssetAssessmentInstance(
      payload,
      { ...manualComputer, asset_category: 'mobile_device' } as NonNetworkAsset,
      'asset_identified'
    )
    assert.equal(result.action, 'created')
    assert.equal((creates[0].question_set_snapshot as unknown[]).length, 9)
  })

  it('does not create a review for an excluded manual computer', async () => {
    const { payload, creates } = makePayload()
    const result = await reconcileManualAssetAssessmentInstance(
      payload,
      { ...manualComputer, assessment_scope: 'excluded' } as NonNetworkAsset,
      'asset_identified'
    )
    assert.equal(result.action, 'none')
    assert.equal(creates.length, 0)
  })

  it('supersedes an open review when the manual computer is retired', async () => {
    const existing = {
      id: 'assessment-1',
      policy_key: 'essential',
      policy_version: 2,
      question_set_snapshot: [{ key: 'endpoint.authorized_users', version: 2 }],
    }
    const { payload, updates } = makePayload([existing])
    const result = await reconcileManualAssetAssessmentInstance(
      payload,
      { ...manualComputer, status: 'retired' } as NonNetworkAsset,
      'asset_identified'
    )
    assert.equal(result.action, 'superseded')
    assert.equal((updates[0].data as { status: string }).status, 'superseded')
  })
})

describe('assessment assignee synchronization', () => {
  it('updates open scanned-asset assessments without creating a new cycle', async () => {
    const existing = {
      id: 'assessment-1',
      assigned_to: 'user-1',
      status: 'in_progress',
    }
    const { payload, creates, updates } = makePayload([existing])

    await syncAssetAssessmentAssignee(payload, { ...workstation, owner: 'user-2' } as Asset)

    assert.equal(creates.length, 0)
    assert.equal(updates.length, 1)
    assert.equal((updates[0].data as { assigned_to: string }).assigned_to, 'user-2')
  })

  it('updates open manual-asset assessments and skips an unchanged owner', async () => {
    const existing = {
      id: 'assessment-1',
      assigned_to: 'user-1',
      status: 'pending',
    }
    const unchanged = makePayload([existing])
    await syncManualAssetAssessmentAssignee(unchanged.payload, manualComputer)
    assert.equal(unchanged.updates.length, 0)

    const changed = makePayload([existing])
    await syncManualAssetAssessmentAssignee(changed.payload, {
      ...manualComputer,
      owner: 'user-2',
    } as NonNetworkAsset)
    assert.equal((changed.updates[0].data as { assigned_to: string }).assigned_to, 'user-2')
  })
})
