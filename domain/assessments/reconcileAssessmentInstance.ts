import type { Payload, PayloadRequest } from 'payload'
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import { RISK_QUESTIONS_V2, type RiskAssetType, type RiskPolicyKey } from '@/domain/risk/catalog-v2'
import { riskAssetTypeForManual, riskAssetTypeForScanned } from '@/domain/risk/risk-asset-type'

const POLICY_CATALOG = [
  { key: 'essential', version: 2 },
  { key: 'reinforced', version: 2 },
] as const
const v2Questions = (
  scope: 'organization' | 'office' | 'asset',
  policy: RiskPolicyKey,
  assetType?: RiskAssetType | null
) =>
  RISK_QUESTIONS_V2.filter(
    question =>
      question.scope === scope &&
      question.policies.includes(policy) &&
      (!question.asset_types ||
        (assetType ? question.asset_types.includes(assetType) : scope !== 'asset'))
  )
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'

export type ReconcileReason =
  | 'initial'
  | 'asset_identified'
  | 'assessment_scope_changed'
  | 'office_changed'
  | 'policy_changed'
  | 'answer_expired'
  | 'manual_review'

async function syncAssessmentAssignee(
  payload: Payload,
  subjectField: 'asset' | 'manual_asset',
  subjectId: string,
  owner: Asset['owner'] | NonNetworkAsset['owner'],
  req?: PayloadRequest
): Promise<void> {
  const open = await payload.find({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 10,
    where: {
      and: [
        { scope: { equals: 'asset' } },
        { [subjectField]: { equals: subjectId } },
        { status: { in: ['pending', 'in_progress'] } },
      ],
    },
  })
  const assignedTo = owner ? relationId(owner) : null
  for (const assessment of open.docs) {
    const current = assessment.assigned_to ? relationId(assessment.assigned_to) : null
    if (current === assignedTo) continue
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, assigned_to}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: this event should trigger a Notification Bell entry for {previous and new asset owner}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    await payload.update({
      collection: 'assessment-instances',
      id: assessment.id,
      overrideAccess: true,
      req,
      data: { assigned_to: assignedTo },
    })
  }
}

export function syncAssetAssessmentAssignee(
  payload: Payload,
  asset: Asset,
  req?: PayloadRequest
): Promise<void> {
  return syncAssessmentAssignee(payload, 'asset', String(asset.id), asset.owner, req)
}

export function syncManualAssetAssessmentAssignee(
  payload: Payload,
  asset: NonNetworkAsset,
  req?: PayloadRequest
): Promise<void> {
  return syncAssessmentAssignee(payload, 'manual_asset', String(asset.id), asset.owner, req)
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString()
}

type NonAssetSubject =
  | { scope: 'organization'; id: string; organizationId: string; is_active: boolean }
  | {
      scope: 'office'
      id: string
      organizationId: string
      is_active: boolean
    }

export async function reconcileAssessmentInstance(
  payload: Payload,
  subject: NonAssetSubject,
  reason: ReconcileReason,
  req?: PayloadRequest
): Promise<{ action: 'created' | 'preserved' | 'superseded' | 'none'; id?: string | number }> {
  const [settingsResult, subscriptionResult, openResult] = await Promise.all([
    payload.find({
      collection: 'organization-settings',
      where: { organization: { equals: subject.organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: subject.organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 10,
      where: {
        and: [
          { organization: { equals: subject.organizationId } },
          { scope: { equals: subject.scope } },
          ...(subject.scope === 'organization'
            ? [{ office: { exists: false } }, { asset: { exists: false } }]
            : [{ office: { equals: subject.id } }, { asset: { exists: false } }]),
          { status: { in: ['pending', 'in_progress'] } },
        ],
      },
    }),
  ])
  const settings = settingsResult.docs[0]
  const subscription = subscriptionResult.docs[0]
  const features =
    subscription?.features &&
    typeof subscription.features === 'object' &&
    !Array.isArray(subscription.features)
      ? subscription.features
      : null
  if (!settings || features?.security_assessments !== true) return { action: 'none' }
  const policy = POLICY_CATALOG.find(item => item.key === settings.assessment_policy_key)
  if (!policy)
    throw new Error('Selected assessment policy is not available in the deployed catalog')

  const applicable = v2Questions(subject.scope, policy.key)
  const expectedKeys = applicable.map(question => `${question.key}@${question.version}`).sort()
  const matching = openResult.docs.find(instance => {
    if (instance.policy_key !== policy.key || instance.policy_version !== policy.version)
      return false
    const snapshot = Array.isArray(instance.question_set_snapshot)
      ? instance.question_set_snapshot
      : []
    const actual = snapshot
      .flatMap(item =>
        item && typeof item === 'object' && 'key' in item && 'version' in item
          ? [`${String(item.key)}@${String(item.version)}`]
          : []
      )
      .sort()
    return JSON.stringify(actual) === JSON.stringify(expectedKeys)
  })
  if (matching) return { action: 'preserved', id: matching.id }

  for (const instance of openResult.docs) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, status: superseded}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'assessment-instances',
      id: instance.id,
      overrideAccess: true,
      req,
      data: { status: 'superseded' },
    })
  }
  if (!applicable.length) return { action: openResult.docs.length ? 'superseded' : 'none' }

  const openedAt = new Date().toISOString()
  const validityDays = Math.min(
    ...applicable.map(question => (policy.key === 'reinforced' ? 180 : 365))
  )
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment target, policy, questions}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {organization or office responsible roles}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  const created = await payload.create({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    data: {
      organization: subject.organizationId,
      scope: subject.scope,
      office: subject.scope === 'office' ? subject.id : null,
      policy_key: policy.key,
      policy_version: policy.version,
      catalog_version: 2,
      question_set_snapshot: applicable.map(question => ({
        key: question.key,
        version: question.version,
        prompt_snapshot: question.prompt,
        options_snapshot: question.options,
        control_key: question.control_key,
      })),
      status: 'pending',
      created_reason: reason,
      opened_at: openedAt,
      due_at: addDays(openedAt, validityDays),
      completion_summary: {
        compliant: 0,
        partially_effective: 0,
        non_compliant: 0,
        not_evaluable: applicable.length,
      },
    },
  })
  return { action: 'created', id: created.id }
}

export async function reconcileAssetAssessmentInstance(
  payload: Payload,
  asset: Asset,
  reason: ReconcileReason,
  req?: PayloadRequest
): Promise<{ action: 'created' | 'preserved' | 'superseded' | 'none'; id?: string | number }> {
  const organizationId = relationId(asset.organization)
  const officeId = relationId(asset.office)

  const [settingsResult, subscriptionResult, openResult] = await Promise.all([
    payload.find({
      collection: 'organization-settings',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { scope: { equals: 'asset' } },
          { asset: { equals: asset.id } },
          { status: { in: ['pending', 'in_progress'] } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 10,
    }),
  ])

  const settings = settingsResult.docs[0]
  const subscription = subscriptionResult.docs[0]
  const features =
    subscription?.features &&
    typeof subscription.features === 'object' &&
    !Array.isArray(subscription.features)
      ? subscription.features
      : null
  if (!settings || !subscription || features?.security_assessments !== true) {
    return { action: 'none' }
  }
  const policy = POLICY_CATALOG.find(
    item => item.key === (settings.assessment_policy_key as RiskPolicyKey)
  )
  if (!policy)
    throw new Error('Selected assessment policy is not available in the deployed catalog')

  // El assessment manual de activo está limitado a endpoints de usuario: workstation para
  // Assets descubiertos y computer (mapeado a workstation) para NonNetworkAssets. Los demás
  // tipos conservan sus resultados automáticos, pero no reciben este cuestionario.
  const assetType = asset.confirmed_type ? riskAssetTypeForScanned(asset.confirmed_type) : null
  const applicable =
    assetType &&
    asset.identified &&
    asset.identification_status === 'confirmed' &&
    asset.status !== 'retired' &&
    !isAssetExcludedFromAssessments(asset)
      ? v2Questions('asset', policy.key, assetType)
      : []
  const expectedKeys = applicable.map(question => `${question.key}@${question.version}`).sort()
  const matching = openResult.docs.find(instance => {
    if (
      relationId(instance.organization) !== organizationId ||
      relationId(instance.office) !== officeId
    )
      return false
    if (instance.policy_key !== policy.key || instance.policy_version !== policy.version)
      return false
    const snapshot = Array.isArray(instance.question_set_snapshot)
      ? instance.question_set_snapshot
      : []
    const actualKeys = snapshot
      .flatMap(item =>
        item && typeof item === 'object' && 'key' in item && 'version' in item
          ? [`${String(item.key)}@${String(item.version)}`]
          : []
      )
      .sort()
    return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
  })
  if (matching) return { action: 'preserved', id: matching.id }

  for (const instance of openResult.docs) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, status: superseded}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'assessment-instances',
      id: instance.id,
      overrideAccess: true,
      req,
      data: { status: 'superseded' },
    })
  }
  if (!applicable.length) return { action: openResult.docs.length ? 'superseded' : 'none' }

  const openedAt = new Date().toISOString()
  const validityDays = Math.min(
    ...applicable.map(question => (policy.key === 'reinforced' ? 180 : 365))
  )
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment target, policy, questions}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {asset owner or responsible office roles}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  const created = await payload.create({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    data: {
      organization: organizationId,
      office: officeId,
      asset: asset.id,
      scope: 'asset',
      policy_key: policy.key,
      policy_version: policy.version,
      catalog_version: 2,
      question_set_snapshot: applicable.map(question => ({
        key: question.key,
        version: question.version,
        prompt_snapshot: question.prompt,
        options_snapshot: question.options,
        control_key: question.control_key,
      })),
      status: 'pending',
      assigned_to: asset.owner ? relationId(asset.owner) : null,
      created_reason: reason,
      opened_at: openedAt,
      due_at: addDays(openedAt, validityDays),
      completion_summary: {
        compliant: 0,
        partially_effective: 0,
        non_compliant: 0,
        not_evaluable: applicable.length,
      },
    },
  })
  return { action: 'created', id: created.id }
}

export async function reconcileManualAssetAssessmentInstance(
  payload: Payload,
  asset: NonNetworkAsset,
  reason: ReconcileReason,
  req?: PayloadRequest
): Promise<{ action: 'created' | 'preserved' | 'superseded' | 'none'; id?: string | number }> {
  const organizationId = relationId(asset.organization)
  const officeId = relationId(asset.office)
  const [settingsResult, subscriptionResult, openResult] = await Promise.all([
    payload.find({
      collection: 'organization-settings',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { scope: { equals: 'asset' } },
          { manual_asset: { equals: asset.id } },
          { status: { in: ['pending', 'in_progress'] } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 10,
    }),
  ])

  const settings = settingsResult.docs[0]
  const subscription = subscriptionResult.docs[0]
  const features =
    subscription?.features &&
    typeof subscription.features === 'object' &&
    !Array.isArray(subscription.features)
      ? subscription.features
      : null
  const policy = settings
    ? POLICY_CATALOG.find(item => item.key === (settings.assessment_policy_key as RiskPolicyKey))
    : null
  const assetType = riskAssetTypeForManual(asset.asset_category)
  const eligible =
    Boolean(assetType) &&
    asset.status !== 'retired' &&
    !isAssetExcludedFromAssessments(asset) &&
    features?.security_assessments === true
  const applicable =
    eligible && policy && assetType ? v2Questions('asset', policy.key, assetType) : []

  if (eligible && settings && !policy)
    throw new Error('Selected assessment policy is not available in the deployed catalog')

  const expectedKeys = applicable.map(question => `${question.key}@${question.version}`).sort()
  const matching = openResult.docs.find(instance => {
    if (
      relationId(instance.organization) !== organizationId ||
      relationId(instance.office) !== officeId
    )
      return false
    if (!policy || instance.policy_key !== policy.key || instance.policy_version !== policy.version)
      return false
    const actualKeys = (
      Array.isArray(instance.question_set_snapshot) ? instance.question_set_snapshot : []
    )
      .flatMap(item =>
        item && typeof item === 'object' && 'key' in item && 'version' in item
          ? [`${String(item.key)}@${String(item.version)}`]
          : []
      )
      .sort()
    return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
  })
  if (matching) return { action: 'preserved', id: matching.id }

  for (const instance of openResult.docs) {
    await payload.update({
      collection: 'assessment-instances',
      id: instance.id,
      overrideAccess: true,
      req,
      data: { status: 'superseded' },
    })
  }
  if (!policy || !applicable.length)
    return { action: openResult.docs.length ? 'superseded' : 'none' }

  const openedAt = new Date().toISOString()
  const validityDays = Math.min(
    ...applicable.map(question => (policy.key === 'reinforced' ? 180 : 365))
  )
  const created = await payload.create({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    data: {
      organization: organizationId,
      office: officeId,
      asset: null,
      manual_asset: asset.id,
      scope: 'asset',
      policy_key: policy.key,
      policy_version: policy.version,
      catalog_version: 2,
      question_set_snapshot: applicable.map(question => ({
        key: question.key,
        version: question.version,
        prompt_snapshot: question.prompt,
        options_snapshot: question.options,
        control_key: question.control_key,
      })),
      status: 'pending',
      assigned_to: asset.owner ? relationId(asset.owner) : null,
      created_reason: reason,
      opened_at: openedAt,
      due_at: addDays(openedAt, validityDays),
      completion_summary: {
        compliant: 0,
        partially_effective: 0,
        non_compliant: 0,
        not_evaluable: applicable.length,
      },
    },
  })
  return { action: 'created', id: created.id }
}

export async function reconcileOrganizationAssessments(
  payload: Payload,
  organizationId: string,
  reason: ReconcileReason,
  req?: PayloadRequest
): Promise<void> {
  const [organization, offices, assets, manualAssets] = await Promise.all([
    payload.findByID({
      collection: 'organizations',
      id: organizationId,
      overrideAccess: true,
      req,
      depth: 0,
    }),
    payload.find({
      collection: 'offices',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1000,
    }),
    payload.find({
      collection: 'assets',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
    }),
    payload.find({
      collection: 'non-network-assets',
      where: {
        and: [
          { organization: { equals: organizationId } },
          { asset_category: { equals: 'computer' } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
    }),
  ])
  await reconcileAssessmentInstance(
    payload,
    {
      scope: 'organization',
      id: String(organization.id),
      organizationId,
      is_active: organization.is_active ?? true,
    },
    reason,
    req
  )
  for (const office of offices.docs) {
    await reconcileAssessmentInstance(
      payload,
      {
        scope: 'office',
        id: String(office.id),
        organizationId,
        is_active: office.is_active ?? true,
      },
      reason,
      req
    )
  }
  for (const asset of assets.docs) {
    await reconcileAssetAssessmentInstance(payload, asset, reason, req)
  }
  for (const asset of manualAssets.docs) {
    await reconcileManualAssetAssessmentInstance(payload, asset, reason, req)
  }
}
