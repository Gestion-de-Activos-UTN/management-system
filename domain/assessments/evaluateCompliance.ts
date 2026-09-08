import type { AnswerValue, ComplianceStatus, Severity } from './catalog'

export type EffectiveAnswerCandidate = {
  id: string
  answer: AnswerValue
  valid_until: string
  source: 'exact' | 'inherited' | 'exception'
  justification?: string | null
}

export type EffectiveAnswer =
  | { state: 'current'; candidate: EffectiveAnswerCandidate }
  | { state: 'not_evaluable'; reason_code: 'answer_expired' | 'answer_missing' }

export function resolveEffectiveAnswer(
  candidates: readonly EffectiveAnswerCandidate[],
  now: Date
): EffectiveAnswer {
  const current = candidates.filter(candidate => Date.parse(candidate.valid_until) > now.getTime())
  const order: EffectiveAnswerCandidate['source'][] = ['exact', 'inherited', 'exception']
  for (const source of order) {
    const found = current.find(candidate => candidate.source === source)
    if (found) return { state: 'current', candidate: found }
  }
  return {
    state: 'not_evaluable',
    reason_code: candidates.length ? 'answer_expired' : 'answer_missing',
  }
}

export type CheckEvaluation = {
  status: ComplianceStatus
  severity: Severity
  reason_code: string
  explanation: string
}

export function evaluateAnswer(
  answer: EffectiveAnswer,
  severity: Severity = 'medium'
): CheckEvaluation {
  if (answer.state === 'not_evaluable') {
    return {
      status: 'not_evaluable',
      severity,
      reason_code: answer.reason_code,
      explanation:
        answer.reason_code === 'answer_expired'
          ? 'The previous answer has expired. A new review is needed before SIAM can evaluate this routine.'
          : 'There is no current answer available for this routine.',
    }
  }
  const status: ComplianceStatus =
    answer.candidate.answer === 'yes'
      ? 'compliant'
      : answer.candidate.answer === 'no'
        ? 'non_compliant'
        : 'not_evaluable'
  return {
    status,
    severity,
    reason_code:
      answer.candidate.answer === 'yes'
        ? 'answer_yes'
        : answer.candidate.answer === 'no'
          ? 'answer_no'
          : answer.candidate.answer === 'unknown'
            ? 'answer_unknown'
            : 'justified_not_applicable',
    explanation:
      status === 'compliant'
        ? 'The current answer confirms this routine is in place.'
        : status === 'non_compliant'
          ? 'The current answer indicates this routine needs attention.'
          : 'The current answer does not provide enough evidence to evaluate this routine.',
  }
}
