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
        throw new Error(`El campo ${field} de la respuesta de revisión no se puede modificar.`)
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
    throw new Error('La respuesta de revisión pertenece a otra organización.')
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
    throw new Error('La pregunta respondida no forma parte del conjunto definido para esta revisión.')
  }

  if (merged.option_key === 'not_applicable' && !String(merged.justification ?? '').trim()) {
    throw new Error('Justifica por qué esta respuesta no aplica.')
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
      throw new Error('Ya existe una respuesta para esta pregunta de revisión.')
  }

  return data
}
