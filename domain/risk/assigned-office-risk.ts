import type { PayloadRequest } from 'payload'
import type { RiskContribution, RiskEvaluation } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canReadAssignedOfficeRisk } from '@/access/rbac/risk-scope'
import { calculateRiskForScope } from './recalculateRisk'
import { createAssignedRiskCache } from './assigned-risk-cache'
import { evaluationFromResult } from './evaluation-from-result'
import { openRiskJob, riskJobStatus, type RecalculationStatus } from './recalculation-status'

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
type AssignedRiskView = { evaluation: RiskEvaluationView; contributions: RiskContributionView[] }

const cache = createAssignedRiskCache<AssignedRiskView>()

/**
 * Every evidence change queues the organization recalculation, so its open job and latest
 * evaluation change whenever a consolidation may differ. Read before calculating: a change during
 * the calculation then forces the next request to recalculate instead of hiding it.
 */
async function evidenceSignal(req: PayloadRequest, organizationId: string) {
  const [latest, job] = await Promise.all([
    req.payload.find({
      collection: 'risk-evaluations',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
      sort: '-evaluated_at',
      where: {
        and: [{ organization: { equals: organizationId } }, { office: { exists: false } }],
      },
    }),
    openRiskJob(req, organizationId),
  ])
  return {
    token: `${latest.docs[0]?.id ?? ''}|${job?.id ?? ''}`,
    recalculation: (job ? riskJobStatus(job) : 'current') satisfies RecalculationStatus,
  }
}

async function calculateAssignedRisk(
  req: PayloadRequest,
  organizationId: string,
  officeIds: string[]
): Promise<AssignedRiskView> {
  const calculated = await calculateRiskForScope(req.payload, { organizationId, officeIds }, req)
  const { result } = calculated
  const evaluation: RiskEvaluationView = {
    id: null,
    evaluated_at: calculated.evaluatedAt.toISOString(),
    ...evaluationFromResult(calculated),
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

/** Live, read-only view: no shared/persisted organization record or synthetic evaluation ID. */
export async function assignedOfficeRisk(req: PayloadRequest, ctx: TenantContext) {
  if (!canReadAssignedOfficeRisk(ctx) || !ctx.organizationId) throw new Error('forbidden')
  const organizationId = ctx.organizationId
  // The office set always comes from the membership, so a cached entry never crosses scopes.
  const officeIds = [...ctx.officeIds].sort()
  const signal = await evidenceSignal(req, organizationId)
  const compute = () => calculateAssignedRisk(req, organizationId, officeIds)
  // A shared promise must not depend on another request's transaction.
  const view = req.transactionID
    ? await compute()
    : await cache.get(`${organizationId}|${officeIds.join(',')}`, signal.token, compute)
  return { ...view, recalculation: signal.recalculation }
}
