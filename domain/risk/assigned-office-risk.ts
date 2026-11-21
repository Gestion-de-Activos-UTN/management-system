import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canReadAssignedOfficeRisk } from '@/access/rbac/risk-scope'
import { calculateRiskForScope } from './recalculateRisk'
import { createAssignedRiskCache } from './assigned-risk-cache'
import type { EvaluationData } from './evaluation-from-pairs'
import { contributionFromPair } from './persistRiskEvaluation'
import { openRiskJob, riskJobStatus, type RecalculationStatus } from './recalculation-status'

/** A persisted evaluation or a live consolidation: the same fields from the same function. */
export type RiskEvaluationView = EvaluationData & { id: string | null; evaluated_at: string }
export type RiskContributionView = ReturnType<typeof contributionFromPair> & { id: string }
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
  const evaluation: RiskEvaluationView = {
    ...calculated.evaluation,
    id: null,
    evaluated_at: calculated.evaluatedAt.toISOString(),
  }
  const contributions: RiskContributionView[] = calculated.pairs.map(pair => ({
    id: `${pair.asset_key}:${pair.control_key}`,
    ...contributionFromPair(pair),
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
