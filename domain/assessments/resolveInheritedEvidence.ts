import type { Payload, PayloadRequest, Where } from 'payload'
import type { AssessmentInstance } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import {
  resolveEffectiveAnswer,
  type EffectiveAnswer,
  type EffectiveAnswerCandidate,
} from './evaluateCompliance'

export async function resolveInheritedAssessmentEvidence(
  payload: Payload,
  assessment: AssessmentInstance,
  req?: PayloadRequest,
  now = new Date()
): Promise<Record<string, EffectiveAnswer>> {
  const organizationId = relationId(assessment.organization)
  const scopeClauses: Where[] = [{ id: { equals: assessment.id } }]
  if (assessment.scope !== 'organization')
    scopeClauses.push({
      scope: { equals: 'organization' },
      status: { equals: 'completed' },
    })
  if (assessment.scope === 'asset' && assessment.office) {
    scopeClauses.push({
      scope: { equals: 'office' },
      office: { equals: relationId(assessment.office) },
      status: { equals: 'completed' },
    })
  }
  const instances = await payload.find({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 100,
    sort: '-completed_at',
    where: { and: [{ organization: { equals: organizationId } }, { or: scopeClauses }] },
  })
  const instanceIds = instances.docs.map(instance => instance.id)
  if (!instanceIds.length) return {}
  const answers = await payload.find({
    collection: 'assessment-answers',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1000,
    sort: '-answered_at',
    where: { assessment: { in: instanceIds } },
  })
  const instanceById = new Map(instances.docs.map(instance => [String(instance.id), instance]))
  const candidates = new Map<string, EffectiveAnswerCandidate[]>()
  for (const answer of answers.docs) {
    const owner = instanceById.get(relationId(answer.assessment))
    if (!owner) continue
    const source: EffectiveAnswerCandidate['source'] =
      answer.answer === 'not_applicable'
        ? 'exception'
        : owner.id === assessment.id
          ? 'exact'
          : 'inherited'
    const rows = candidates.get(answer.question_key) ?? []
    rows.push({
      id: String(answer.id),
      answer: answer.answer,
      valid_until: answer.valid_until,
      source,
      justification: answer.justification,
    })
    candidates.set(answer.question_key, rows)
  }
  return Object.fromEntries(
    [...candidates].map(([questionKey, rows]) => [questionKey, resolveEffectiveAnswer(rows, now)])
  )
}
