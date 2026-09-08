import type { ScannedAssetType } from '@/domain/assets/asset-types'
import type { AnswerValue, PolicyDefinition, QuestionDefinition } from './catalog'

export type AssessmentSubject =
  | { scope: 'organization'; is_active: boolean }
  | { scope: 'office'; is_active: boolean }
  | {
      scope: 'asset'
      status: 'active' | 'offline' | 'retired'
      identified: boolean
      identification_status: 'pending' | 'confirmed' | 'needs_review'
      confirmed_type: ScannedAssetType | null
    }

export type ApplicabilityEvidence = {
  answers?: Readonly<Record<string, AnswerValue | undefined>>
  include_unresolved_answer_dependencies?: boolean
  technical_coverage?: {
    port_scan?: 'complete' | 'partial' | 'not_attempted' | 'unknown'
    service_detection?: 'complete' | 'partial' | 'not_attempted' | 'unknown'
  }
}

// Cobertura parcial o desconocida nunca autoriza una conclusión automática. En el catálogo
// manual v1 no oculta preguntas cotidianas; esta guarda es la entrada común para los checks
// técnicos del Hito 5 y evita interpretar una ausencia de observación como protección.
export function hasSufficientTechnicalCoverage(evidence: ApplicabilityEvidence): boolean {
  return (
    evidence.technical_coverage?.port_scan === 'complete' &&
    evidence.technical_coverage.service_detection === 'complete'
  )
}

function dependencyMatches(
  question: QuestionDefinition,
  subject: AssessmentSubject,
  policy: PolicyDefinition,
  evidence: ApplicabilityEvidence
): boolean {
  return (question.dependencies ?? []).every(dependency => {
    if (dependency.type === 'policy_includes') {
      return dependency.policies.includes(policy.key)
    }
    if (dependency.type === 'requires_confirmed_asset_type') {
      return (
        subject.scope === 'asset' &&
        subject.confirmed_type !== null &&
        dependency.asset_types.includes(subject.confirmed_type)
      )
    }
    const answer = evidence.answers?.[dependency.question_key]
    return answer === undefined
      ? evidence.include_unresolved_answer_dependencies === true
      : dependency.answers.includes(answer)
  })
}

export function resolveApplicableQuestions(
  subject: AssessmentSubject,
  policy: PolicyDefinition,
  evidence: ApplicabilityEvidence,
  questions: readonly QuestionDefinition[]
): QuestionDefinition[] {
  if (subject.scope !== 'asset' && !subject.is_active) return []
  if (
    subject.scope === 'asset' &&
    (subject.status === 'retired' ||
      !subject.identified ||
      subject.identification_status !== 'confirmed' ||
      !subject.confirmed_type)
  ) {
    return []
  }

  return questions.filter(question => {
    if (question.scope !== subject.scope || !question.policies.includes(policy.key)) return false
    if (
      subject.scope === 'asset' &&
      !question.applies_to_asset_types?.includes(subject.confirmed_type as ScannedAssetType)
    ) {
      return false
    }
    return dependencyMatches(question, subject, policy, evidence)
  })
}
