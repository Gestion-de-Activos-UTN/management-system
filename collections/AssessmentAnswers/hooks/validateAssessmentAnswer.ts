import type { CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import {
  assertAssessmentMutable,
  type AssessmentStatus,
} from '@/collections/AssessmentInstances/invariants'

export const validateAssessmentAnswer: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const merged = { ...originalDoc, ...data }
  const assessmentId = relationId(merged.assessment)
  const organizationId = relationId(merged.organization)

  if (operation === 'update') {
    for (const field of [
      'organization',
      'assessment',
      'question_key',
      'question_version',
    ] as const) {
      if (field in data && String(data[field] ?? '') !== String(originalDoc?.[field] ?? '')) {
        throw new Error(`Assessment answer field ${field} is immutable`)
      }
    }
  }

  const assessment = await req.payload.findByID({
    collection: 'assessment-instances',
    id: assessmentId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (relationId(assessment.organization) !== organizationId)
    throw new Error('Assessment answer belongs to another organization')
  assertAssessmentMutable(assessment.status as AssessmentStatus)

  const snapshot = Array.isArray(assessment.question_set_snapshot)
    ? assessment.question_set_snapshot
    : []
  const expected = snapshot.find(item => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Record<string, unknown>
    return candidate.key === merged.question_key && candidate.version === merged.question_version
  })
  if (!expected) {
    throw new Error('Assessment answer question is not part of the frozen question set')
  }

  if (merged.answer === 'not_applicable' && !String(merged.justification ?? '').trim()) {
    throw new Error('Not applicable answers require a justification')
  }

  if (operation === 'create') {
    const duplicate = await req.payload.find({
      collection: 'assessment-answers',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
      where: {
        and: [
          { assessment: { equals: assessmentId } },
          { question_key: { equals: merged.question_key } },
        ],
      },
    })
    if (duplicate.docs.length)
      throw new Error('An answer already exists for this assessment question')
  }

  return data
}
