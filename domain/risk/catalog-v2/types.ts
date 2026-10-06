import type { RiskSeverity } from '../constants'

export const RISK_POLICY_KEYS = ['essential', 'reinforced'] as const
export type RiskPolicyKey = (typeof RISK_POLICY_KEYS)[number]

export const RISK_ASSET_TYPES = [
  'workstation',
  'mobile',
  'server',
  'gateway',
  'network_device',
] as const
export type RiskAssetType = (typeof RISK_ASSET_TYPES)[number]

export type QuestionScope = 'organization' | 'office' | 'asset'

export type AnswerOptionV2 = {
  key: string
  label: string
  efficacy: number | null
  requires_justification?: boolean
}

export type RiskQuestionV2 = {
  key: string
  version: 2
  control_key: string
  scope: QuestionScope
  prompt: string
  help_text: string
  policies: readonly RiskPolicyKey[]
  // Asset questions: required target types. Office/organization questions: optional restriction of
  // which assets inherit the answer (absent = every asset in scope).
  asset_types?: readonly RiskAssetType[]
  options: readonly AnswerOptionV2[]
}

export type RiskControlV2 = {
  key: string
  title: string
  severity: RiskSeverity | 'by_network_rule' | 'coverage_only'
  question_keys: readonly string[]
}

export type ConditionalRuleV2 = {
  key: string
  control_key: string
  input_question_keys: readonly string[]
  operation: 'force_zero' | 'multiply'
  when_option_key: string
  target_question_key: string
  value: number
}

export type RiskCatalogV2 = {
  version: 2
  questions: readonly RiskQuestionV2[]
  controls: readonly RiskControlV2[]
  conditional_rules: readonly ConditionalRuleV2[]
}
