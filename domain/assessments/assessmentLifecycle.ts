import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentAnswer, AssessmentInstance } from '@/app/types/payload-types'
import {
  RISK_CONTROLS_V2,
  RISK_QUESTIONS_V2,
  type RiskPolicyKey,
  type RiskQuestionV2,
} from '@/domain/risk/catalog-v2'
import type { SaveAssessmentDraft } from '@/modules/assessments/schema'
import { relationId } from '@/lib/relationId'
import { evaluateAutomaticComplianceForAssessment } from './evaluateAutomaticCompliance'
import { evaluateControlEfficacy } from '@/domain/risk/control-efficacy'
import {
  enqueueOrganizationRiskRecalculation,
  enqueueRiskRecalculation,
} from '@/domain/risk/enqueueRiskRecalculation'
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'

function questionDefinition(key: string, version: number): RiskQuestionV2 {
  const definition = RISK_QUESTIONS_V2.find(item => item.key === key && item.version === version)
  if (!definition) throw new Error(`Question ${key} v${version} is unavailable`)
  return definition
}

// The engine reads severity from the catalog; this only keeps the stored result consistent with it.
function controlSeverity(controlKey: string) {
  const severity = RISK_CONTROLS_V2.find(control => control.key === controlKey)?.severity
  return (
    (['low', 'medium', 'high', 'critical'] as const).find(item => item === severity) ?? 'medium'
  )
}

function validUntil(answeredAt: string, days: number): string {
  return new Date(Date.parse(answeredAt) + days * 24 * 60 * 60 * 1000).toISOString()
}

export function buildCopiedAssessmentDraft(
  sourceAnswers: readonly AssessmentAnswer[],
  targetSnapshot: unknown
): SaveAssessmentDraft {
  const versions = new Map(
    (Array.isArray(targetSnapshot) ? targetSnapshot : []).flatMap(item =>
      item && typeof item === 'object' && 'key' in item && 'version' in item
        ? [[String(item.key), Number(item.version)] as const]
        : []
    )
  )
  return {
    answers: sourceAnswers.flatMap(answer => {
      const version = versions.get(answer.question_key)
      return version
        ? [
            {
              question_key: answer.question_key,
              question_version: version,
              option_key: answer.option_key,
              justification: answer.justification ?? undefined,
              evidence_note: answer.evidence_note ?? undefined,
            },
          ]
        : []
    }),
  }
}

function assertAnswerAllowed(
  answer: SaveAssessmentDraft['answers'][number],
  policyKey: RiskPolicyKey
) {
  const definition = questionDefinition(answer.question_key, answer.question_version)
  if (!definition.policies.includes(policyKey))
    throw new Error(`Question  is not available for this policy`)
  const option = definition.options.find(item => item.key === answer.option_key)
  if (!option) throw new Error(`Option  is not available for `)
  if (option.requires_justification && !answer.justification?.trim())
    throw new Error('Not applicable answers require a justification')
  const status =
    option.efficacy === null
      ? 'not_evaluable'
      : option.efficacy === 1
        ? 'compliant'
        : option.efficacy === 0
          ? 'non_compliant'
          : 'partially_effective'
  return {
    definition,
    option,
    effect: {
      status,
      base_efficacy: option.efficacy,
      adjusted_efficacy: option.efficacy,
      combined_efficacy: option.efficacy,
      applied_rules: [],
      source: 'exact',
    },
    validityDays: policyKey === 'reinforced' ? 180 : 365,
  }
}

async function loadAssessment(
  payload: Payload,
  assessmentId: string,
  req: PayloadRequest
): Promise<AssessmentInstance> {
  return payload.findByID({
    collection: 'assessment-instances',
    id: assessmentId,
    overrideAccess: true,
    req,
    depth: 0,
  })
}

async function assertTargetIncluded(
  payload: Payload,
  assessment: AssessmentInstance,
  req: PayloadRequest
) {
  const target = assessment.asset
    ? await payload.findByID({
        collection: 'assets',
        id: relationId(assessment.asset),
        overrideAccess: true,
        req,
        depth: 0,
      })
    : assessment.manual_asset
      ? await payload.findByID({
          collection: 'non-network-assets',
          id: relationId(assessment.manual_asset),
          overrideAccess: true,
          req,
          depth: 0,
        })
      : null
  if (target && isAssetExcludedFromAssessments(target))
    throw new Error('asset_excluded_from_assessments')
}

async function upsertAnswers(
  payload: Payload,
  assessment: AssessmentInstance,
  command: SaveAssessmentDraft,
  actorId: string,
  req: PayloadRequest
): Promise<AssessmentAnswer[]> {
  if (!['pending', 'in_progress'].includes(assessment.status))
    throw new Error(`Assessment in status ${assessment.status} cannot be changed`)
  const snapshot = Array.isArray(assessment.question_set_snapshot)
    ? assessment.question_set_snapshot
    : []
  const allowed = new Set(
    snapshot.flatMap(item =>
      item && typeof item === 'object' && 'key' in item && 'version' in item
        ? [`${String(item.key)}@${String(item.version)}`]
        : []
    )
  )
  const now = new Date().toISOString()
  const saved: AssessmentAnswer[] = []
  for (const answer of command.answers) {
    if (!allowed.has(`${answer.question_key}@${answer.question_version}`))
      throw new Error(`Question ${answer.question_key} is not part of this review`)
    const { effect, option, validityDays } = assertAnswerAllowed(
      answer,
      assessment.policy_key as RiskPolicyKey
    )
    const existing = await payload.find({
      collection: 'assessment-answers',
      where: {
        and: [
          { assessment: { equals: assessment.id } },
          { question_key: { equals: answer.question_key } },
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    })
    const answerData = {
      option_key: answer.option_key,
      option_snapshot: { key: option.key, label: option.label, efficacy: option.efficacy },
      justification: answer.justification ?? null,
      evidence_note: answer.evidence_note ?? null,
      answered_by: actorId,
      answered_at: now,
      valid_until: validUntil(now, validityDays),
      evaluation_effect_snapshot: effect,
    }
    const createData = {
      organization: relationId(assessment.organization),
      assessment: assessment.id,
      question_key: answer.question_key,
      question_version: answer.question_version,
      ...answerData,
    }
    if (existing.docs[0]) {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, question, draft answer}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      saved.push(
        await payload.update({
          collection: 'assessment-answers',
          id: existing.docs[0].id,
          overrideAccess: true,
          req,
          data: answerData,
        })
      )
    } else {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, question, draft answer}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      saved.push(
        await payload.create({
          collection: 'assessment-answers',
          overrideAccess: true,
          req,
          data: createData,
        })
      )
    }
  }
  if (assessment.status === 'pending' && saved.length) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, status: in_progress}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'assessment-instances',
      id: assessment.id,
      overrideAccess: true,
      req,
      data: { status: 'in_progress' },
    })
  }
  return saved
}

export async function saveAssessmentDraft(
  payload: Payload,
  assessmentId: string,
  command: SaveAssessmentDraft,
  actorId: string,
  req: PayloadRequest
) {
  const assessment = await loadAssessment(payload, assessmentId, req)
  await assertTargetIncluded(payload, assessment, req)
  return upsertAnswers(payload, assessment, command, actorId, req)
}

export async function completeAssessment(
  payload: Payload,
  assessmentId: string,
  command: SaveAssessmentDraft,
  actorId: string,
  request: PayloadRequest
) {
  const ownsTransaction = !request.transactionID
  const transactionID = request.transactionID ?? (await payload.db.beginTransaction())
  const req = Object.assign(request, { transactionID })
  try {
    let assessment = await loadAssessment(payload, assessmentId, req)
    await assertTargetIncluded(payload, assessment, req)
    if (assessment.status === 'completed') {
      if (ownsTransaction && transactionID) await payload.db.commitTransaction(transactionID)
      return assessment
    }
    await upsertAnswers(payload, assessment, command, actorId, req)
    assessment = await loadAssessment(payload, assessmentId, req)
    const answers = await payload.find({
      collection: 'assessment-answers',
      where: { assessment: { equals: assessment.id } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 100,
    })
    const snapshot = Array.isArray(assessment.question_set_snapshot)
      ? assessment.question_set_snapshot
      : []
    const snapshotKeys = snapshot.flatMap(item =>
      item && typeof item === 'object' && 'key' in item && 'version' in item
        ? [{ key: String(item.key), version: Number(item.version) }]
        : []
    )
    const answerByKey = new Map(answers.docs.map(answer => [answer.question_key, answer]))
    const requiredKeys = snapshotKeys.map(item => item.key)
    const missing = requiredKeys.filter(key => !answerByKey.has(key))
    if (missing.length)
      throw new Error(`Every visible question must be answered: ${missing.join(', ')}`)

    const policyKey = assessment.policy_key as RiskPolicyKey
    const optionKeys = Object.fromEntries(
      answers.docs.map(answer => [answer.question_key, answer.option_key])
    )
    const controlKeys = [
      ...new Set(requiredKeys.map(key => questionDefinition(key, 2).control_key)),
    ]
    const controlEffects = new Map(
      controlKeys.map(controlKey => [
        controlKey,
        evaluateControlEfficacy(controlKey, optionKeys, policyKey),
      ])
    )
    const counts = { compliant: 0, partially_effective: 0, non_compliant: 0, not_evaluable: 0 }
    for (const result of controlEffects.values()) {
      const status =
        result.efficacy === null
          ? 'not_evaluable'
          : result.efficacy === 1
            ? 'compliant'
            : result.efficacy === 0
              ? 'non_compliant'
              : 'partially_effective'
      counts[status] += 1
    }
    const completedAt = new Date().toISOString()
    const validUntilDates: string[] = []
    const persistedControls = new Set<string>()
    for (const key of requiredKeys) {
      let answer = answerByKey.get(key)!
      const definition = questionDefinition(answer.question_key, answer.question_version)
      const combined = controlEffects.get(definition.control_key)!
      const sub = combined.sub.find(item => item.question_key === answer.question_key)!
      const status: keyof typeof counts =
        combined.efficacy === null
          ? 'not_evaluable'
          : combined.efficacy === 1
            ? 'compliant'
            : combined.efficacy === 0
              ? 'non_compliant'
              : 'partially_effective'
      const effect = {
        status,
        reason_code: combined.status,
        base_efficacy: sub.base,
        adjusted_efficacy: sub.adjusted,
        combined_efficacy: combined.efficacy,
        sub_efficacies: combined.sub,
        applied_rules: combined.applied_rules,
        source: 'exact',
      }
      const frozenValidUntil = validUntil(
        completedAt,
        assessment.policy_key === 'reinforced' ? 180 : 365
      )
      validUntilDates.push(frozenValidUntil)
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment answer validity}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      answer = await payload.update({
        collection: 'assessment-answers',
        id: answer.id,
        overrideAccess: true,
        req,
        data: { valid_until: frozenValidUntil, evaluation_effect_snapshot: effect },
      })
      if (persistedControls.has(definition.control_key)) continue
      persistedControls.add(definition.control_key)
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment answer result}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await payload.create({
        collection: 'compliance-results',
        overrideAccess: true,
        req,
        data: {
          organization: relationId(assessment.organization),
          office: assessment.office ? relationId(assessment.office) : null,
          asset: assessment.asset ? relationId(assessment.asset) : null,
          manual_asset: assessment.manual_asset ? relationId(assessment.manual_asset) : null,
          control_key: definition.control_key,
          check_key: `manual:${answer.question_key}`,
          status: effect.status === 'partially_effective' ? 'non_compliant' : effect.status,
          severity: controlSeverity(definition.control_key),
          policy_key: assessment.policy_key,
          policy_version: assessment.policy_version,
          evaluated_at: answer.answered_at,
          valid_until: answer.valid_until,
          reason_code: effect.reason_code,
          explanation:
            effect.status === 'compliant'
              ? 'The current review confirms this routine is in place.'
              : effect.status === 'non_compliant'
                ? 'The current review indicates this routine needs attention.'
                : 'The current review does not provide enough evidence to evaluate this routine.',
          evidence_snapshot: {
            assessment_id: assessment.id,
            answer_id: answer.id,
            question_key: answer.question_key,
            question_version: answer.question_version,
            evaluation_effect: effect,
          },
        },
      })
    }
    await evaluateAutomaticComplianceForAssessment(payload, assessment, req, new Date(completedAt))
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment, status, summary}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: this event should trigger a Notification Bell entry for {organization and office security review readers}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    const completed = await payload.update({
      collection: 'assessment-instances',
      id: assessment.id,
      overrideAccess: true,
      req,
      data: {
        status: 'completed',
        completed_at: completedAt,
        completed_by: actorId,
        due_at: validUntilDates.sort()[0] ?? completedAt,
        completion_summary: counts,
      },
    })
    if (ownsTransaction && transactionID) await payload.db.commitTransaction(transactionID)
    // Organization answers are inherited by every office evaluation.
    if (assessment.office)
      await enqueueRiskRecalculation(payload, relationId(assessment.organization), [
        relationId(assessment.office),
      ])
    else await enqueueOrganizationRiskRecalculation(payload, relationId(assessment.organization))
    return completed
  } catch (error) {
    if (ownsTransaction && transactionID) await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}
