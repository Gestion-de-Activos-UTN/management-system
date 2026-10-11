import type { AssessmentInstance } from '@/app/types/payload-types'

export function deriveAssessmentStatus(
  assessment: AssessmentInstance,
  now = new Date()
): AssessmentInstance['status'] {
  if (
    assessment.status === 'completed' &&
    Number.isFinite(Date.parse(assessment.due_at)) &&
    Date.parse(assessment.due_at) <= now.getTime()
  ) {
    return 'expired'
  }
  return assessment.status
}

export function withDerivedAssessmentStatus(
  assessment: AssessmentInstance,
  now = new Date()
): AssessmentInstance {
  const status = deriveAssessmentStatus(assessment, now)
  return status === assessment.status ? assessment : { ...assessment, status }
}
