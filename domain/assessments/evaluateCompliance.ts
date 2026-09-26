import type { ComplianceStatus, Severity } from './catalog'

export type EffectiveAnswerCandidate = {
  id: string
  option_key: string
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
