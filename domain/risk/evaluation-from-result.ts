import type { RiskPolicyKey } from './catalog-v2'
import { RISK_CATALOG_VERSION, RISK_ENGINE_VERSION } from './constants'
import type { RiskEvaluationResult } from './engine'

/** Evaluation fields shared by persisted evaluations and live assigned-office consolidations. */
export function evaluationFromResult(input: {
  policy: RiskPolicyKey
  result: RiskEvaluationResult
  undeterminedExposure: ReadonlyArray<{ asset_id: string; cidr: string }>
}) {
  const { result } = input
  return {
    catalog_version: RISK_CATALOG_VERSION,
    engine_version: RISK_ENGINE_VERSION,
    policy_key: input.policy,
    score: result.score,
    base_band: result.base_band,
    final_band: result.final_band,
    coverage: result.coverage,
    unknown_percentage: result.unknown_percentage,
    confidence: result.confidence,
    effective_confidence: result.effective_confidence,
    counts: result.counts,
    alerts: {
      critical_assets: result.critical_asset_alerts,
      systemic_failures: result.controls
        .filter(item => item.systemic_failure)
        .map(item => item.control_key),
      severe_concentration: result.severe_concentration,
      severe_concentration_percentage: result.severe_concentration_percentage,
      undetermined_exposure: [...input.undeterminedExposure],
    },
    control_summary: result.controls,
    asset_summary: result.assets,
  }
}
