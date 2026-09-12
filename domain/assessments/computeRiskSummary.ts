import type { ComplianceStatus, PolicyDefinition, Severity } from './catalog'

export type RiskCheck = {
  key: string
  control_key: string
  status: ComplianceStatus
  severity: Severity
  criticality?: 'low' | 'medium' | 'high' | 'critical' | null
}

export type RiskSummary = {
  risk_score: number | null
  evaluated_percentage: number
  requires_attention: number
  not_evaluable: number
  applicable_checks: number
  pending_asset_identifications: number
  excluded_assets: number
  last_valid_scan_at: string | null
  policy: { key: string; version: number }
}

export function computeRiskSummary(
  checks: readonly RiskCheck[],
  policy: PolicyDefinition,
  context: {
    pendingAssetIdentifications?: number
    excludedAssets?: number
    lastValidScanAt?: string | null
  } = {}
): RiskSummary {
  let evaluatedWeight = 0
  let nonCompliantWeight = 0
  let evaluated = 0
  let requiresAttention = 0
  let notEvaluable = 0

  for (const check of checks) {
    if (check.status === 'not_evaluable') {
      notEvaluable += 1
      continue
    }
    evaluated += 1
    const weight =
      policy.risk_weights.severity[check.severity] *
      policy.risk_weights.criticality[check.criticality ?? 'unknown'] *
      (policy.risk_weights.controls[check.control_key] ?? policy.risk_weights.default_control)
    evaluatedWeight += weight
    if (check.status === 'non_compliant') {
      requiresAttention += 1
      nonCompliantWeight += weight
    }
  }

  return {
    risk_score:
      evaluatedWeight === 0 ? null : Math.round((nonCompliantWeight / evaluatedWeight) * 100),
    evaluated_percentage: checks.length ? Math.round((evaluated / checks.length) * 100) : 0,
    requires_attention: requiresAttention,
    not_evaluable: notEvaluable,
    applicable_checks: checks.length,
    pending_asset_identifications: context.pendingAssetIdentifications ?? 0,
    excluded_assets: context.excludedAssets ?? 0,
    last_valid_scan_at: context.lastValidScanAt ?? null,
    policy: { key: policy.key, version: policy.version },
  }
}
