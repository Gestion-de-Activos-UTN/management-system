import type { PayloadRequest } from 'payload'
import type { RiskContribution, RiskEvaluation } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canReadAssignedOfficeRisk } from '@/access/rbac/risk-scope'
import { calculateRiskForScope } from './recalculateRisk'

export type RiskEvaluationView = Omit<
  Pick<
    RiskEvaluation,
    | 'id'
    | 'evaluated_at'
    | 'engine_version'
    | 'catalog_version'
    | 'policy_key'
    | 'score'
    | 'base_band'
    | 'final_band'
    | 'coverage'
    | 'unknown_percentage'
    | 'confidence'
    | 'effective_confidence'
    | 'counts'
    | 'alerts'
    | 'control_summary'
    | 'asset_summary'
  >,
  'id'
> & { id: string | null }
export type RiskContributionView = Pick<
  RiskContribution,
  | 'id'
  | 'asset_key'
  | 'control_key'
  | 'status'
  | 'criticality'
  | 'severity'
  | 'exposure'
  | 'exposure_source'
  | 'scope_multiplier'
  | 'efficacy'
  | 'inherent_risk'
  | 'residual_risk'
  | 'excluded'
  | 'reason_code'
>

/** Live, read-only view: no shared/persisted organization record or synthetic evaluation ID. */
export async function assignedOfficeRisk(req: PayloadRequest, ctx: TenantContext) {
  if (!canReadAssignedOfficeRisk(ctx) || !ctx.organizationId) throw new Error('forbidden')
  const calculated = await calculateRiskForScope(
    req.payload,
    {
      organizationId: ctx.organizationId,
      officeIds: ctx.officeIds,
    },
    req
  )
  const { result } = calculated
  const evaluation: RiskEvaluationView = {
    id: null,
    evaluated_at: calculated.evaluatedAt.toISOString(),
    engine_version: 2,
    catalog_version: 2,
    policy_key: calculated.policy,
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
      undetermined_exposure: calculated.undeterminedExposure,
    },
    control_summary: result.controls,
    asset_summary: result.assets,
  }
  const contributions: RiskContributionView[] = result.contributions.map(row => ({
    id: `${row.asset_id}:${row.control_key}`,
    asset_key: row.asset_id,
    control_key: row.control_key,
    status: row.status,
    criticality: row.criticality,
    severity: row.severity,
    exposure: row.exposure,
    exposure_source: row.exposure_source ?? null,
    scope_multiplier: row.scope_multiplier,
    efficacy: row.efficacy,
    inherent_risk: row.inherent_risk,
    residual_risk: row.residual_risk,
    excluded: Boolean(row.excluded),
    reason_code: row.reason_code,
  }))
  return { evaluation, contributions }
}
