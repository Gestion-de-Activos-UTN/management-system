import { RISK_CATALOG_V2 } from './catalog-v2'
import type { RiskCatalogV2, RiskPolicyKey } from './catalog-v2/types'

export type SubEfficacy = {
  question_key: string
  option_key: string | null
  base: number | null
  adjusted: number | null
}

export type ControlEfficacyResult = {
  status: 'evaluable' | 'not_evaluable' | 'not_applicable'
  efficacy: number | null
  sub: SubEfficacy[]
  applied_rules: string[]
}

/**
 * Plan §3.3: one pair per control. Applies local conditionals, drops justified `not_applicable`
 * sub-questions, then averages. Any remaining sub-question without efficacy (unknown or missing)
 * makes the whole pair `not_evaluable`. Only for question-based controls; automatic controls
 * (A.5.9, A.5.12, A.8.16, A.8.20, A.8.21) are evaluated from evidence.
 */
export function evaluateControlEfficacy(
  controlKey: string,
  answers: Readonly<Record<string, string | null | undefined>>,
  policy: RiskPolicyKey,
  catalog: RiskCatalogV2 = RISK_CATALOG_V2
): ControlEfficacyResult {
  const control = catalog.controls.find(item => item.key === controlKey)
  if (!control?.question_keys.length) {
    throw new Error(`Control ${controlKey} is not evaluated from questions`)
  }

  const sub: SubEfficacy[] = control.question_keys
    .map(key => catalog.questions.find(question => question.key === key)!)
    .filter(question => question.policies.includes(policy))
    .map(question => {
      const optionKey = answers[question.key] ?? null
      const option =
        optionKey === null ? undefined : question.options.find(o => o.key === optionKey)
      if (optionKey !== null && !option) {
        throw new Error(`Answer ${optionKey} is not an option of ${question.key}`)
      }
      const base = option?.efficacy ?? null
      return { question_key: question.key, option_key: optionKey, base, adjusted: base }
    })

  const appliedRules: string[] = []
  for (const rule of catalog.conditional_rules) {
    if (rule.control_key !== controlKey) continue
    if (!rule.input_question_keys.some(key => answers[key] === rule.when_option_key)) continue
    const target = sub.find(item => item.question_key === rule.target_question_key)
    if (!target) continue
    if (rule.operation === 'force_zero') {
      // Forced even when the target is unknown: the dependency makes its value certain.
      target.adjusted = 0
    } else {
      if (target.adjusted === null) continue
      target.adjusted *= rule.value
    }
    appliedRules.push(rule.key)
  }

  const counted = sub.filter(
    item => !(item.option_key === 'not_applicable' && item.adjusted === null)
  )
  if (!counted.length) {
    return { status: 'not_applicable', efficacy: null, sub, applied_rules: appliedRules }
  }
  if (counted.some(item => item.adjusted === null)) {
    return { status: 'not_evaluable', efficacy: null, sub, applied_rules: appliedRules }
  }
  const efficacy = counted.reduce((sum, item) => sum + item.adjusted!, 0) / counted.length
  return { status: 'evaluable', efficacy, sub, applied_rules: appliedRules }
}
