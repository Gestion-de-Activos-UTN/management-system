import type { Endpoint, PayloadRequest, Where } from 'payload'
import { z } from 'zod'
import { assignedOfficeRisk, type RiskEvaluationView } from '@/domain/risk/assigned-office-risk'
import { organizationFeatures } from '@/domain/subscriptions/features'
import { canReadAssignedOfficeRisk } from '@/access/rbac/risk-scope'
import { RISK_DEFAULT_PAGE_SIZE, RISK_PAGE_SIZES } from '@/domain/risk/constants'
import { indexVisible } from '@/domain/risk/deficiency-index'
import type { AssetIndex } from '@/domain/risk/evaluation-from-pairs'
import { buildRiskLists, type ListRow, type SubjectRef } from '@/domain/risk/risk-lists'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo } from '@/access/rbac/permissions'
import { officeQueryError } from '@/access/tenant/officeQueryError'
import { riskRecalculationStatus } from '@/domain/risk/recalculation-status'
import type {
  LatestRiskResponse,
  RiskEvaluationDTO,
  RiskList,
  RiskScope,
  Subject,
} from '@/modules/risk/service'
import type { RecalculationStatus } from '@/domain/risk/recalculation-status'

const json = (body: unknown, status = 200) => Response.json(body, { status })

const querySchema = z.object({
  office_id: z.string().min(1).optional(),
  evaluation_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .refine(value => (RISK_PAGE_SIZES as readonly number[]).includes(value))
    .default(RISK_DEFAULT_PAGE_SIZE),
  list: z.enum(['deficiencies', 'pending']).default('deficiencies'),
})

type Labels = ReadonlyMap<string, string>

// Resuelve los nombres visibles de lo que muestra la respuesta: activos, oficinas y la organización.
// Consultas con `in` siempre filtradas por la organización del usuario.
async function assetLabels(
  req: PayloadRequest,
  organizationId: string,
  keys: Iterable<string>,
  officeIds: Iterable<string> = []
) {
  const network: string[] = []
  const manual: string[] = []
  const offices = [...new Set(officeIds)]
  for (const key of new Set(keys)) {
    if (key.startsWith('asset:')) network.push(key.slice('asset:'.length))
    else if (key.startsWith('manual:')) manual.push(key.slice('manual:'.length))
  }
  const scoped = (ids: string[]): Where => ({
    and: [{ organization: { equals: organizationId } }, { id: { in: ids } }],
  })
  const [assets, manualAssets, officeDocs, organization] = await Promise.all([
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
    offices.length
      ? req.payload.find({
          collection: 'offices',
          where: scoped(offices),
          overrideAccess: true,
          req,
          depth: 0,
          limit: offices.length,
          pagination: false,
        })
      : null,
    req.payload.findByID({
      collection: 'organizations',
      id: organizationId,
      overrideAccess: true,
      req,
      depth: 0,
      select: { name: true },
    }),
  ])
  const labels = new Map<string, string>()
  for (const doc of assets?.docs ?? [])
    labels.set(`asset:${doc.id}`, doc.alias || doc.hostname || doc.ip || doc.mac || doc.asset_id)
  for (const doc of manualAssets?.docs ?? []) labels.set(`manual:${doc.id}`, doc.alias)
  for (const doc of officeDocs?.docs ?? []) labels.set(`office:${doc.id}`, doc.name)
  labels.set('organization', organization.name)
  return labels
}

const TOP_ASSETS = 10

/** Assets whose own index is visible, highest first; ties by key so pages never reshuffle. */
const topAssets = (row: Pick<RiskEvaluationView, 'asset_summary'>) =>
  row.asset_summary
    .filter((item): item is AssetIndex & { index: number } => indexVisible(item.visibility) && item.index !== null)
    .sort((a, b) => b.index - a.index || (a.asset_key < b.asset_key ? -1 : a.asset_key > b.asset_key ? 1 : 0))
    .slice(0, TOP_ASSETS)

/** Every asset and office the evaluation DTO names, so one label lookup serves it all. */
const evaluationRefs = (row: RiskEvaluationView) => ({
  assets: [
    ...topAssets(row).map(item => item.asset_key),
    ...row.context.shared_cidr.flatMap(group => group.important_assets),
  ],
  offices: [
    ...row.context.office_visibility.map(item => item.office_id),
    ...row.context.shared_cidr.map(group => group.office_id),
  ],
})

const label = (labels: Labels, key: string) => labels.get(key) ?? 'Activo no disponible'

const evaluationDTO = (row: RiskEvaluationView, labels: Labels): RiskEvaluationDTO => {
  // Plan §6: a hidden index is never exposed, not only hidden by the UI.
  const showIndex = indexVisible(row.visibility)
  const refs = evaluationRefs(row)
  return {
    id: row.id,
    evaluated_at: row.evaluated_at,
    engine_version: row.engine_version,
    catalog_version: row.catalog_version,
    policy_key: row.policy_key,
    index: showIndex ? row.index : null,
    band: row.visibility === 'banded' ? row.band : null,
    coverage: row.coverage,
    visibility: row.visibility,
    // Coverage and warnings stay visible; D_c follows the index.
    controls: row.control_summary.map(control => ({
      ...control,
      deficiency: showIndex ? control.deficiency : null,
    })),
    counts: row.counts,
    context: {
      ...row.context,
      labels: Object.fromEntries(
        [...refs.assets, ...refs.offices.map(id => `office:${id}`)].map(key => [
          key,
          labels.get(key) ?? (key.startsWith('office:') ? 'Oficina no disponible' : 'Activo no disponible'),
        ])
      ),
    },
    top_assets: showIndex
      ? topAssets(row).map(item => ({
          asset_key: item.asset_key,
          asset_label: label(labels, item.asset_key),
          index: item.index,
          band: item.band,
        }))
      : [],
  }
}

const subjectDTO = (subject: SubjectRef, labels: Labels, organizationId: string): Subject =>
  subject.kind === 'asset'
    ? { ...subject, asset_label: label(labels, subject.asset_key) }
    : subject.kind === 'office'
      ? { ...subject, label: labels.get(`office:${subject.id}`) ?? 'Oficina no disponible' }
      : { ...subject, id: organizationId, label: labels.get('organization') ?? 'Organización' }

/**
 * Both lists are built over every row of the evaluation (contracts §7): totals and the fixed order
 * never depend on the page. Only the subjects of the requested page are labelled.
 */
// ponytail: builds the lists in memory over all rows; same scale limit as loading every
// contribution of an evaluation. Persist the items if an evaluation reaches tens of thousands.
async function listResponse(input: {
  req: PayloadRequest
  organizationId: string
  scope: RiskScope
  recalculation: RecalculationStatus | undefined
  evaluation: RiskEvaluationView
  rows: readonly ListRow[]
  officeScope?: ReadonlySet<string>
  list: RiskList
  page: number
  limit: number
}): Promise<LatestRiskResponse> {
  const { evaluation, page, limit } = input
  const lists = buildRiskLists(input.rows, evaluation.context, input.officeScope)
  const all = input.list === 'deficiencies' ? lists.deficiencies : lists.pending
  const pageOf = <T,>(items: readonly T[]) => items.slice((page - 1) * limit, page * limit)
  const items = pageOf<{ subject: SubjectRef }>(all)
  const refs = evaluationRefs(evaluation)
  const labels = await assetLabels(
    input.req,
    input.organizationId,
    [...refs.assets, ...items.flatMap(item => (item.subject.kind === 'asset' ? [item.subject.asset_key] : []))],
    [...refs.offices, ...items.flatMap(item => (item.subject.kind === 'office' ? [item.subject.id] : []))]
  )
  const withSubject = <T extends { subject: SubjectRef }>(item: T) => ({
    ...item,
    subject: subjectDTO(item.subject, labels, input.organizationId),
  })
  const totalDocs = all.length
  const common = {
    scope: input.scope,
    recalculation: input.recalculation,
    evaluation: evaluationDTO(evaluation, labels),
    totals: { deficiencies: lists.deficiencies.length, pending: lists.pending.length },
    pagination: {
      page,
      totalPages: Math.ceil(totalDocs / limit),
      totalDocs,
      hasNextPage: page * limit < totalDocs,
    },
  }
  return input.list === 'deficiencies'
    ? { ...common, list: 'deficiencies', items: pageOf(lists.deficiencies).map(withSubject) }
    : { ...common, list: 'pending', items: pageOf(lists.pending).map(withSubject) }
}

/** Read-only: persisted organization/office history, or a live consolidation of assigned offices. */
export const latestRiskEvaluationEndpoint: Endpoint = {
  path: '/v1/risk/latest',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx?.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    if (!canDo(ctx.role, 'risk-evaluations', 'read', ctx.organizationId))
      return json({ error: 'forbidden' }, 403)
    if (!(await organizationFeatures(req, ctx.organizationId)).risk_score)
      return json({ error: 'feature_disabled' }, 403)
    const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
    const query = querySchema.safeParse({
      office_id: params.get('office_id') ?? undefined,
      page: params.get('page') ?? undefined,
      limit: params.get('limit') ?? undefined,
      evaluation_id: params.get('evaluation_id') ?? undefined,
      list: params.get('list') ?? undefined,
    })
    if (!query.success) return json({ error: 'invalid_query' }, 400)
    const {
      office_id: officeId,
      page,
      limit,
      evaluation_id: evaluationId,
      list,
    } = query.data
    // The client cannot supply the office set: it always comes from the resolved membership.
    const assignedScope = !officeId && !evaluationId && canReadAssignedOfficeRisk(ctx)
    const officeError = assignedScope ? null : officeQueryError(ctx, officeId)
    if (officeError) return json({ error: officeError }, 403)

    if (assignedScope) {
      const assigned = await assignedOfficeRisk(req, ctx).catch((error: unknown) => {
        req.payload.logger.error({ err: error }, 'assigned office risk calculation failed')
        return null
      })
      if (!assigned) return json({ error: 'risk_unavailable' }, 503)
      const { evaluation, contributions, recalculation } = assigned
      return json(
        await listResponse({
          req,
          organizationId: ctx.organizationId,
          scope: 'assigned_offices',
          recalculation,
          evaluation,
          rows: contributions,
          officeScope: new Set(ctx.officeIds),
          list,
          page,
          limit,
        })
      )
    }

    const where: Where = {
      and: [
        { organization: { equals: ctx.organizationId } },
        ...(evaluationId ? [{ id: { equals: evaluationId } }] : []),
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
    // Server read with overrideAccess: field access does not mask it, evaluationDTO does.
    const evaluation = latest.docs[0] as unknown as (RiskEvaluationView & { id: string }) | undefined
    if (evaluationId && !evaluation) return json({ error: 'evaluation_not_found' }, 404)
    const recalculation = evaluationId
      ? undefined
      : await riskRecalculationStatus(req, ctx.organizationId, officeId, evaluation?.evaluated_at)
    const empty = { page, totalPages: 0, totalDocs: 0, hasNextPage: false }
    if (!evaluation)
      return json({
        scope: officeId ? 'office' : 'organization',
        evaluation: null,
        recalculation,
        list,
        items: [],
        totals: { deficiencies: 0, pending: 0 },
        pagination: empty,
      } satisfies LatestRiskResponse)
    const contributions = await req.payload.find({
      collection: 'risk-contributions',
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      where: {
        and: [
          { organization: { equals: ctx.organizationId } },
          { evaluation: { equals: evaluation.id } },
        ],
      },
    })
    return json(
      await listResponse({
        req,
        organizationId: ctx.organizationId,
        scope: officeId ? 'office' : 'organization',
        recalculation,
        evaluation,
        rows: contributions.docs as unknown as ListRow[],
        // An office evaluation only ever names its own office.
        officeScope: officeId ? new Set([officeId]) : undefined,
        list,
        page,
        limit,
      })
    )
  },
}

export default latestRiskEvaluationEndpoint
