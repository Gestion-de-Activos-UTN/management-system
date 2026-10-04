import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentInstance, Asset, NonNetworkAsset } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { relationId } from '@/lib/relationId'
import type { BulkAssessmentComplete, BulkAssessmentSelector } from '@/modules/assessments/schema'
import { canAnswerAssessment } from './assessmentAccess'
import { completeAssessment } from './assessmentLifecycle'
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'
import { riskAssetTypeForManual, riskAssetTypeForScanned } from '@/domain/risk/risk-asset-type'
import { enqueueRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'

type AssessmentTarget = Asset | NonNetworkAsset

export type BulkAssessmentSummary = {
  assessment_id: string
  asset_id: string
  asset_label: string
  asset_source: 'network' | 'manual'
  office_id: string
  owner_id: string | null
  status: AssessmentInstance['status']
  has_draft: boolean
}

export type BulkAssessmentPreview = {
  question_set_signature: string | null
  question_set_snapshot: AssessmentInstance['question_set_snapshot'] | null
  representative_assessment: AssessmentInstance | null
  applicable: BulkAssessmentSummary[]
  preserved_completed: BulkAssessmentSummary[]
  incompatible: number
}

export type BulkAssessmentResult = {
  completed: number
  preserved_completed: number
  affected_office_ids: string[]
}

export function questionSetSignature(snapshot: unknown): string {
  return (Array.isArray(snapshot) ? snapshot : [])
    .flatMap(item =>
      item && typeof item === 'object' && 'key' in item && 'version' in item
        ? [`${String(item.key)}@${Number(item.version)}`]
        : []
    )
    .sort()
    .join('|')
}

function targetKey(instance: AssessmentInstance): string | null {
  if (instance.asset) return `asset:${relationId(instance.asset)}`
  if (instance.manual_asset) return `manual:${relationId(instance.manual_asset)}`
  return null
}

function targetRiskType(target: AssessmentTarget) {
  if ('asset_category' in target) return riskAssetTypeForManual(target.asset_category)
  return target.confirmed_type ? riskAssetTypeForScanned(target.confirmed_type) : null
}

function targetMatchesSelector(target: AssessmentTarget, selector: BulkAssessmentSelector) {
  if (targetRiskType(target) !== selector.risk_asset_type) return false
  if (selector.mode === 'owner')
    return Boolean(target.owner && relationId(target.owner) === selector.owner_id)
  if (selector.mode === 'office') return relationId(target.office) === selector.office_id
  return true
}

function targetIsEligible(target: AssessmentTarget) {
  return target.status !== 'retired' && !isAssetExcludedFromAssessments(target)
}

function summary(
  assessment: AssessmentInstance,
  target: AssessmentTarget,
  hasDraft: boolean
): BulkAssessmentSummary {
  const manual = 'asset_category' in target
  return {
    assessment_id: String(assessment.id),
    asset_id: String(target.id),
    asset_label: target.alias || (!manual ? target.hostname || target.ip : null) || 'Activo',
    asset_source: manual ? 'manual' : 'network',
    office_id: relationId(target.office),
    owner_id: target.owner ? relationId(target.owner) : null,
    status: assessment.status,
    has_draft: hasDraft,
  }
}

async function loadTargets(payload: Payload, instances: AssessmentInstance[], req: PayloadRequest) {
  const assetIds = [
    ...new Set(instances.flatMap(instance => (instance.asset ? [relationId(instance.asset)] : []))),
  ]
  const manualIds = [
    ...new Set(
      instances.flatMap(instance =>
        instance.manual_asset ? [relationId(instance.manual_asset)] : []
      )
    ),
  ]
  const [assets, manualAssets] = await Promise.all([
    assetIds.length
      ? payload.find({
          collection: 'assets',
          where: { id: { in: assetIds } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: assetIds.length,
        })
      : Promise.resolve({ docs: [] as Asset[] }),
    manualIds.length
      ? payload.find({
          collection: 'non-network-assets',
          where: { id: { in: manualIds } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: manualIds.length,
        })
      : Promise.resolve({ docs: [] as NonNetworkAsset[] }),
  ])
  return new Map<string, AssessmentTarget>([
    ...assets.docs.map(asset => [`asset:${asset.id}`, asset] as const),
    ...manualAssets.docs.map(asset => [`manual:${asset.id}`, asset] as const),
  ])
}

export async function resolveBulkAssessmentPreview(
  payload: Payload,
  ctx: TenantContext,
  selector: BulkAssessmentSelector,
  req: PayloadRequest
): Promise<BulkAssessmentPreview> {
  if (!ctx.organizationId) throw new Error('organization_context_required')
  const result = await payload.find({
    collection: 'assessment-instances',
    where: {
      and: [{ organization: { equals: ctx.organizationId } }, { scope: { equals: 'asset' } }],
    },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 5000,
    sort: '-createdAt',
  })
  const instances = result.docs
  const targets = await loadTargets(payload, instances, req)
  const grouped = new Map<string, AssessmentInstance[]>()
  for (const instance of instances) {
    const key = targetKey(instance)
    const target = key ? targets.get(key) : null
    if (!key || !target || !targetMatchesSelector(target, selector)) continue
    const rows = grouped.get(key) ?? []
    rows.push(instance)
    grouped.set(key, rows)
  }

  const openCandidates: Array<{ assessment: AssessmentInstance; target: AssessmentTarget }> = []
  const closedCandidates: Array<{ assessment: AssessmentInstance; target: AssessmentTarget }> = []
  for (const [key, cycles] of grouped) {
    const target = targets.get(key)!
    if (!targetIsEligible(target)) continue
    const open = cycles.find(cycle => ['pending', 'in_progress'].includes(cycle.status))
    if (open) {
      if (canAnswerAssessment(ctx, open, target)) openCandidates.push({ assessment: open, target })
      continue
    }
    const closed = cycles.find(cycle => ['completed', 'expired'].includes(cycle.status))
    if (closed && canAnswerAssessment(ctx, closed, target))
      closedCandidates.push({ assessment: closed, target })
  }

  const signatureCounts = new Map<string, number>()
  for (const { assessment } of openCandidates) {
    const signature = questionSetSignature(assessment.question_set_snapshot)
    if (signature) signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1)
  }
  const expectedSignature = [...signatureCounts].sort(
    ([leftSignature, leftCount], [rightSignature, rightCount]) =>
      rightCount - leftCount || leftSignature.localeCompare(rightSignature)
  )[0]?.[0]
  const compatible = expectedSignature
    ? openCandidates.filter(
        item => questionSetSignature(item.assessment.question_set_snapshot) === expectedSignature
      )
    : []
  const openIds = compatible.map(item => String(item.assessment.id))
  const answerResult = openIds.length
    ? await payload.find({
        collection: 'assessment-answers',
        where: { assessment: { in: openIds } },
        overrideAccess: true,
        req,
        depth: 0,
        limit: Math.max(100, openIds.length * 100),
      })
    : { docs: [] }
  const assessmentsWithAnswers = new Set(
    answerResult.docs.map(answer => relationId(answer.assessment))
  )

  return {
    question_set_signature: expectedSignature ?? null,
    question_set_snapshot: compatible[0]?.assessment.question_set_snapshot ?? null,
    representative_assessment: compatible[0]?.assessment ?? null,
    applicable: compatible.map(({ assessment, target }) =>
      summary(assessment, target, assessmentsWithAnswers.has(String(assessment.id)))
    ),
    preserved_completed: closedCandidates.map(({ assessment, target }) =>
      summary(assessment, target, false)
    ),
    incompatible: openCandidates.length - compatible.length,
  }
}

export async function completeBulkAssessments(
  payload: Payload,
  ctx: TenantContext,
  command: BulkAssessmentComplete,
  actorId: string,
  request: PayloadRequest
): Promise<BulkAssessmentResult> {
  if (!ctx.organizationId) throw new Error('organization_context_required')
  const preview = await resolveBulkAssessmentPreview(payload, ctx, command.selector, request)
  if (
    preview.question_set_signature &&
    preview.question_set_signature !== command.question_set_signature
  )
    throw new Error('bulk_preview_stale')
  const selectable = new Set([
    ...preview.applicable.map(item => item.assessment_id),
    ...preview.preserved_completed.map(item => item.assessment_id),
  ])
  if (command.assessment_ids.some(id => !selectable.has(id)))
    throw new Error('bulk_selection_stale')

  const ownsTransaction = !request.transactionID
  const transactionID = request.transactionID ?? (await payload.db.beginTransaction())
  const req = Object.assign(request, { transactionID })
  let completed = 0
  let preservedCompleted = 0
  const officeIds = new Set<string>()
  try {
    for (const assessmentId of command.assessment_ids) {
      const assessment = await payload.findByID({
        collection: 'assessment-instances',
        id: assessmentId,
        overrideAccess: true,
        req,
        depth: 0,
      })
      if (['completed', 'expired'].includes(assessment.status)) {
        preservedCompleted += 1
        continue
      }
      if (!['pending', 'in_progress'].includes(assessment.status))
        throw new Error('bulk_selection_stale')
      if (questionSetSignature(assessment.question_set_snapshot) !== command.question_set_signature)
        throw new Error('bulk_preview_stale')
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {bulk assessment, targets, answers}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await completeAssessment(payload, assessmentId, { answers: command.answers }, actorId, req, {
        enqueueRisk: false,
      })
      completed += 1
      if (assessment.office) officeIds.add(relationId(assessment.office))
    }
    if (ownsTransaction && transactionID) await payload.db.commitTransaction(transactionID)
  } catch (error) {
    if (ownsTransaction && transactionID) await payload.db.rollbackTransaction(transactionID)
    throw error
  }
  await enqueueRiskRecalculation(payload, ctx.organizationId, [...officeIds])
  // NOTIFY: this event should trigger a Notification Bell entry for {affected assessment owners}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return {
    completed,
    preserved_completed: preservedCompleted,
    affected_office_ids: [...officeIds],
  }
}
