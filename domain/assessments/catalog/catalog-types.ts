import type { ScannedAssetType } from '@/domain/assets/asset-types'
import { RISK_POLICY_KEYS, type RiskPolicyKey } from '@/domain/risk/catalog-v2/types'

// Shared enums for stored assessment/compliance rows. Questions and controls live in
// domain/risk/catalog-v2; only the network baseline dictionary (A.8.21) remains here.
export const POLICY_KEYS = RISK_POLICY_KEYS
export type PolicyKey = RiskPolicyKey

export const ASSESSMENT_SCOPES = ['organization', 'office', 'asset'] as const
export type AssessmentScope = (typeof ASSESSMENT_SCOPES)[number]

// New values go LAST: the dev schema push then only appends them (ALTER TYPE … ADD VALUE).
// Inserting in the middle can make drizzle recreate the enum and prompt interactively.
export const COMPLIANCE_STATUSES = [
  'compliant',
  'non_compliant',
  'not_evaluable',
  'partially_effective',
  'not_applicable',
] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

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
