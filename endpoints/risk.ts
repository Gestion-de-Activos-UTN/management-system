import type { Endpoint, PayloadRequest, Where } from 'payload'
import { z } from 'zod'
import type { RiskContribution, RiskEvaluation } from '@/app/types/payload-types'
import type { AssetRiskScore } from '@/domain/risk/engine'
import { bandVisible, scoreVisible } from '@/domain/risk/constants'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo } from '@/access/rbac/permissions'
import { officeQueryError } from '@/access/tenant/officeQueryError'
import type {
  LatestRiskResponse,
  RiskContributionDTO,
  RiskEvaluationDTO,
} from '@/modules/risk/service'

const json = (body: unknown, status = 200) => Response.json(body, { status })

const querySchema = z.object({
  office_id: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

type Labels = ReadonlyMap<string, string>

// ponytail: only the assets shown on screen are resolved (one page + top list + alerts), so the
// response stays bounded no matter how large the fleet is.
async function assetLabels(req: PayloadRequest, organizationId: string, keys: Iterable<string>) {
  const network: string[] = []
  const manual: string[] = []
  for (const key of new Set(keys)) {
    if (key.startsWith('asset:')) network.push(key.slice('asset:'.length))
    else if (key.startsWith('manual:')) manual.push(key.slice('manual:'.length))
  }
  const scoped = (ids: string[]): Where => ({
    and: [{ organization: { equals: organizationId } }, { id: { in: ids } }],
  })
  const [assets, manualAssets] = await Promise.all([
    network.length
      ? req.payload.find({
          collection: 'assets',
          where: scoped(network),
          overrideAccess: true,
          req,
          depth: 0,
          limit: network.length,
          pagination: false,
        })
      : null,
    manual.length
      ? req.payload.find({
          collection: 'non-network-assets',
          where: scoped(manual),
          overrideAccess: true,
          req,
          depth: 0,
          limit: manual.length,
          pagination: false,
        })
      : null,
  ])
  const labels = new Map<string, string>()
  for (const doc of assets?.docs ?? [])
    labels.set(`asset:${doc.id}`, doc.alias || doc.hostname || doc.ip || doc.mac || doc.asset_id)
  for (const doc of manualAssets?.docs ?? []) labels.set(`manual:${doc.id}`, doc.alias)
  return labels
}

const TOP_ASSETS = 10

const topAssets = (row: RiskEvaluation) =>
  [...(row.asset_summary as AssetRiskScore[])]
    .sort((a, b) => b.residual_risk - a.residual_risk)
    .slice(0, TOP_ASSETS)

type StoredAlerts = {
  critical_assets: Array<{ asset_id: string; control_key: string }>
  systemic_failures: string[]
  severe_concentration: boolean
  severe_concentration_percentage: number
  undetermined_exposure: Array<{ asset_id: string; cidr: string }>
}

const label = (labels: Labels, key: string) => labels.get(key) ?? 'Activo no disponible'

const evaluationDTO = (row: RiskEvaluation, labels: Labels): RiskEvaluationDTO => {
  const alerts = row.alerts as StoredAlerts
  const showScore = scoreVisible(row.confidence)
  const showBand = bandVisible(row.confidence)
  return {
    id: String(row.id),
    evaluated_at: row.evaluated_at,
    engine_version: row.engine_version,
    catalog_version: row.catalog_version,
    policy_key: row.policy_key,
    // Plan §3.8: a hidden score is never exposed, not only hidden by the UI.
    score: showScore ? (row.score ?? null) : null,
    base_band: showBand ? (row.base_band ?? null) : null,
    final_band: showBand ? (row.final_band ?? null) : null,
    coverage: row.coverage,
    unknown_percentage: row.unknown_percentage,
    confidence: row.confidence,
    effective_confidence: row.effective_confidence,
    counts: row.counts as RiskEvaluationDTO['counts'],
    alerts: {
      ...alerts,
      critical_assets: alerts.critical_assets.map(item => ({
        ...item,
        asset_label: label(labels, item.asset_id),
      })),
      undetermined_exposure: alerts.undetermined_exposure.map(item => ({
        ...item,
        asset_label: label(labels, item.asset_id),
      })),
    },
    // Per-control and per-asset numbers follow the same visibility rule as the global score.
    controls: showScore ? (row.control_summary as RiskEvaluationDTO['controls']) : [],
    top_assets: showScore
      ? topAssets(row).map(item => ({
          ...item,
          band: showBand ? item.band : null,
          asset_label: label(labels, item.asset_id),
        }))
      : [],
  }
}

const contributionDTO = (
  row: RiskContribution,
  labels: Labels,
  showScore: boolean
): RiskContributionDTO => ({
  id: String(row.id),
  asset_key: row.asset_key,
  asset_label: label(labels, row.asset_key),
  control_key: row.control_key,
  status: row.status,
  criticality: row.criticality,
  severity: row.severity,
  exposure: row.exposure,
  exposure_source: row.exposure_source ?? null,
  scope_multiplier: row.scope_multiplier,
  efficacy: row.efficacy ?? null,
  inherent_risk: showScore ? (row.inherent_risk ?? null) : null,
  residual_risk: showScore ? (row.residual_risk ?? null) : null,
  excluded: row.excluded,
  reason_code: row.reason_code,
})

async function riskFeatureEnabled(req: Parameters<Endpoint['handler']>[0], organizationId: string) {
  const result = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const features = result.docs[0]?.features
  return Boolean(
    features &&
    typeof features === 'object' &&
    !Array.isArray(features) &&
    features.risk_score === true
  )
}

/** Read-only: returns the latest persisted evaluation. Never calculates during a GET. */
export const latestRiskEvaluationEndpoint: Endpoint = {
  path: '/v1/risk/latest',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx?.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    if (!canDo(ctx.role, 'risk-evaluations', 'read', ctx.organizationId))
      return json({ error: 'forbidden' }, 403)
    if (!(await riskFeatureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
    const query = querySchema.safeParse({
      office_id: params.get('office_id') ?? undefined,
      page: params.get('page') ?? undefined,
    })
    if (!query.success) return json({ error: 'invalid_query' }, 400)
    const { office_id: officeId, page } = query.data
    // Office-scoped roles never read the organization-wide evaluation (other offices' assets).
    const officeError = officeQueryError(ctx, officeId)
    if (officeError) return json({ error: officeError }, 403)

    const where: Where = {
      and: [
        { organization: { equals: ctx.organizationId } },
        officeId ? { office: { equals: officeId } } : { office: { exists: false } },
      ],
    }
    const latest = await req.payload.find({
      collection: 'risk-evaluations',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
      sort: '-evaluated_at',
      where,
    })
    const evaluation = latest.docs[0]
    const empty = { page, totalPages: 0, totalDocs: 0, hasNextPage: false }
    if (!evaluation)
      return json({
        evaluation: null,
        contributions: [],
        pagination: empty,
      } satisfies LatestRiskResponse)
    const contributions = await req.payload.find({
      collection: 'risk-contributions',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 100,
      page,
      sort: 'control_key',
      where: {
        and: [
          { organization: { equals: ctx.organizationId } },
          { evaluation: { equals: evaluation.id } },
        ],
      },
    })
    const alerts = evaluation.alerts as StoredAlerts
    const labels = await assetLabels(req, ctx.organizationId, [
      ...contributions.docs.map(row => row.asset_key),
      ...topAssets(evaluation).map(item => item.asset_id),
      ...alerts.critical_assets.map(item => item.asset_id),
      ...alerts.undetermined_exposure.map(item => item.asset_id),
    ])
    return json({
      evaluation: evaluationDTO(evaluation, labels),
      contributions: contributions.docs.map(row =>
        contributionDTO(row, labels, scoreVisible(evaluation.confidence))
      ),
      pagination: {
        page,
        totalPages: contributions.totalPages,
        totalDocs: contributions.totalDocs,
        hasNextPage: contributions.hasNextPage,
      },
    } satisfies LatestRiskResponse)
  },
}

export default latestRiskEvaluationEndpoint
