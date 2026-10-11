import { RISK_ASSET_TYPES, RISK_POLICY_KEYS, type RiskCatalogV2 } from './types'

const assertUnique = (values: readonly string[], label: string) => {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index)
  if (duplicate) throw new Error(`Risk catalog v2 has duplicate ${label}: ${duplicate}`)
}

export function validateRiskCatalogV2(catalog: RiskCatalogV2): void {
  if (catalog.version !== 2) throw new Error('Risk catalog v2 must use version 2')
  assertUnique(
    catalog.controls.map(item => item.key),
    'control key'
  )
  assertUnique(
    catalog.questions.map(item => item.key),
    'question key'
  )
  assertUnique(
    catalog.conditional_rules.map(item => item.key),
    'conditional rule key'
  )

  const controls = new Map(catalog.controls.map(item => [item.key, item]))
  const questions = new Map(catalog.questions.map(item => [item.key, item]))

  for (const question of catalog.questions) {
    if (!controls.has(question.control_key)) {
      throw new Error(`Question ${question.key} references missing control ${question.control_key}`)
    }
    if (!question.prompt.trim() || !question.help_text.trim()) {
      throw new Error(`Question ${question.key} requires prompt and help text`)
    }
    if (question.scope === 'asset' && !question.asset_types?.length) {
      throw new Error(`Asset question ${question.key} requires asset types`)
    }
    for (const type of question.asset_types ?? []) {
      if (!RISK_ASSET_TYPES.includes(type)) {
        throw new Error(`Question ${question.key} has invalid asset type ${type}`)
      }
    }
    assertUnique(question.policies, `policy in ${question.key}`)
    for (const policy of question.policies) {
      if (!RISK_POLICY_KEYS.includes(policy)) {
        throw new Error(`Question ${question.key} has invalid policy ${policy}`)
      }
    }
    assertUnique(
      question.options.map(item => item.key),
      `option in ${question.key}`
    )
    for (const option of question.options) {
      if (!option.label.trim())
        throw new Error(`Question ${question.key} has an empty option label`)
      if (
        option.efficacy !== null &&
        (!Number.isFinite(option.efficacy) || option.efficacy < 0 || option.efficacy > 1)
      ) {
        throw new Error(`Question ${question.key} has efficacy outside 0..1`)
      }
    }
    const unknown = question.options.find(item => item.key === 'unknown')
    const notApplicable = question.options.find(item => item.key === 'not_applicable')
    if (unknown?.efficacy !== null || notApplicable?.efficacy !== null) {
      throw new Error(`Question ${question.key} must keep unknown options not evaluable`)
    }
    if (!notApplicable?.requires_justification) {
      throw new Error(`Question ${question.key} must justify not_applicable`)
    }
  }

  for (const control of catalog.controls) {
    assertUnique(control.question_keys, `question in ${control.key}`)
    for (const key of control.question_keys) {
      if (questions.get(key)?.control_key !== control.key) {
        throw new Error(`Control ${control.key} references an invalid question ${key}`)
      }
    }
  }

  for (const rule of catalog.conditional_rules) {
    if (!controls.has(rule.control_key)) throw new Error(`Rule ${rule.key} has a missing control`)
    for (const key of rule.input_question_keys) {
      const input = questions.get(key)
      if (input?.control_key !== rule.control_key) {
        throw new Error(`Rule ${rule.key} has an invalid input question`)
      }
      // A typo here would silently disable the rule.
      if (!input.options.some(option => option.key === rule.when_option_key)) {
        throw new Error(`Rule ${rule.key} triggers on missing option ${rule.when_option_key}`)
      }
    }
    if (questions.get(rule.target_question_key)?.control_key !== rule.control_key) {
      throw new Error(`Rule ${rule.key} has an invalid target question`)
    }
    if (!Number.isFinite(rule.value) || rule.value < 0 || rule.value > 1) {
      throw new Error(`Rule ${rule.key} has an invalid value`)
    }
  }
}
