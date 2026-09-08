import type { ScannedAssetType } from '@/domain/assets/asset-types'

export const POLICY_KEYS = ['essential', 'reinforced'] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

export const ASSESSMENT_SCOPES = ['organization', 'office', 'asset'] as const
export type AssessmentScope = (typeof ASSESSMENT_SCOPES)[number]

export const ANSWER_VALUES = ['yes', 'no', 'unknown', 'not_applicable'] as const
export type AnswerValue = (typeof ANSWER_VALUES)[number]

export const COMPLIANCE_STATUSES = ['compliant', 'non_compliant', 'not_evaluable'] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export type EvaluationEffect = {
  status: ComplianceStatus
  reason_code: string
}

export type QuestionDependency =
  | {
      type: 'requires_question_answer'
      question_key: string
      answers: AnswerValue[]
    }
  | {
      type: 'requires_confirmed_asset_type'
      asset_types: ScannedAssetType[]
    }
  | {
      type: 'policy_includes'
      policies: PolicyKey[]
    }

export type QuestionDefinition = {
  key: string
  version: number
  control_keys: string[]
  scope: AssessmentScope
  prompt: string
  help_text: string
  why_it_matters: string
  inherits_to?: Array<'office' | 'asset'>
  applies_to_asset_types?: ScannedAssetType[]
  policies: PolicyKey[]
  validity_days: Record<PolicyKey, number>
  evidence_note_required_for?: Array<'yes' | 'no'>
  dependencies?: QuestionDependency[]
  evaluation: Record<AnswerValue, EvaluationEffect>
}

export type ControlDefinition = {
  key: string
  version: number
  title: string
  scopes: AssessmentScope[]
}

export type RiskWeights = {
  severity: Record<Severity, number>
  criticality: Record<'low' | 'medium' | 'high' | 'critical' | 'unknown', number>
  controls: Record<string, number>
  default_control: number
}

export type PolicyDefinition = {
  key: PolicyKey
  version: number
  name: string
  description: string
  review_frequency_days: number
  question_keys: string[]
  risk_weights: RiskWeights
}

export type NetworkRuleClassification = 'expected' | 'prohibited' | 'review' | 'not_evaluable'

export type NetworkBaselineRule = {
  key: string
  version: number
  control_key: string
  protocols: Array<'tcp' | 'udp'>
  ports: number[]
  classification: NetworkRuleClassification
  severity: Severity
  minimum_confidence: number
  requires_complete_port_coverage: boolean
  applies_to_asset_types?: ScannedAssetType[]
  message: string
  recommendation: string
}

export type AssessmentCatalog = {
  catalog_version: number
  controls: readonly ControlDefinition[]
  questions: readonly QuestionDefinition[]
  policies: readonly PolicyDefinition[]
  network_rules: readonly NetworkBaselineRule[]
}
