import type { Payload, PayloadRequest } from 'payload'
import type { AssessmentAnswer, AssessmentInstance } from '@/app/types/payload-types'
import {
  QUESTION_CATALOG,
  type AnswerValue,
  type PolicyKey,
  type QuestionDefinition,
} from './catalog'
import type { SaveAssessmentDraft } from '@/modules/assessments/schema'
import { relationId } from '@/lib/relationId'
import { evaluateAutomaticComplianceForAssessment } from './evaluateAutomaticCompliance'
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'

function questionDefinition(key: string, version: number): QuestionDefinition {
  const definition = QUESTION_CATALOG.find(item => item.key === key && item.version === version)
  if (!definition) throw new Error(`Question ${key}@${version} is unavailable`)
  return definition as QuestionDefinition
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
              answer: answer.answer,
              justification: answer.justification ?? undefined,
              evidence_note: answer.evidence_note ?? undefined,
            },
          ]
        : []
    }),
  }
}

function assertAnswerAllowed(answer: SaveAssessmentDraft['answers'][number], policyKey: PolicyKey) {
  const definition = questionDefinition(answer.question_key, answer.question_version)
  if (answer.answer === 'not_applicable' && !answer.justification?.trim())
    throw new Error('Not applicable answers require a justification')
  if (
    definition.evidence_note_required_for?.includes(answer.answer as 'yes' | 'no') &&
    !answer.evidence_note?.trim()
  ) {
    throw new Error(`Question ${answer.question_key} requires a short evidence note`)
  }
  return {
    definition,
    effect: definition.evaluation[answer.answer as AnswerValue],
    validityDays: definition.validity_days[policyKey],
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
    const { effect, validityDays } = assertAnswerAllowed(answer, assessment.policy_key as PolicyKey)
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
      answer: answer.answer,
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
    const requiredKeys = snapshotKeys
      .filter(item => {
        const definition = questionDefinition(item.key, item.version)
        return (definition.dependencies ?? []).every(dependency => {
          if (dependency.type !== 'requires_question_answer') return true
          const dependencyAnswer = answerByKey.get(dependency.question_key)?.answer
          return Boolean(dependencyAnswer && dependency.answers.includes(dependencyAnswer))
        })
      })
      .map(item => item.key)
    const missing = requiredKeys.filter(key => !answerByKey.has(key))
    if (missing.length)
      throw new Error(`Every visible question must be answered: ${missing.join(', ')}`)

    const counts = { compliant: 0, non_compliant: 0, not_evaluable: 0 }
    const completedAt = new Date().toISOString()
    const validUntilDates: string[] = []
    for (const key of requiredKeys) {
      let answer = answerByKey.get(key)!
      const effect = answer.evaluation_effect_snapshot
      counts[effect.status] += 1
      const definition = questionDefinition(answer.question_key, answer.question_version)
      const frozenValidUntil = validUntil(
        completedAt,
        definition.validity_days[assessment.policy_key as PolicyKey]
      )
      validUntilDates.push(frozenValidUntil)
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {assessment answer validity}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      answer = await payload.update({
        collection: 'assessment-answers',
        id: answer.id,
        overrideAccess: true,
        req,
        data: { valid_until: frozenValidUntil },
      })
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
          control_key: definition.control_keys[0],
          check_key: `manual:${answer.question_key}`,
          status: effect.status,
          severity: 'medium',
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
    return completed
  } catch (error) {
    if (ownsTransaction && transactionID) await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}
