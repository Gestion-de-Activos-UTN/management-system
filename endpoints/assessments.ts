import type { Endpoint, PayloadRequest, Where } from 'payload'
import type { AssessmentInstance, Asset, NonNetworkAsset } from '@/app/types/payload-types'
import { getTenantContext, type TenantContext } from '@/access/tenant/resolveTenantContext'
import { relationId } from '@/lib/relationId'
import {
  AssessmentListQuerySchema,
  CompleteAssessmentSchema,
  ReopenAssessmentSchema,
  SaveAssessmentDraftSchema,
  UpdateAssessmentPolicySchema,
} from '@/modules/assessments/schema'
import { canAnswerAssessment, canReadAssessment } from '@/domain/assessments/assessmentAccess'
import {
  buildCopiedAssessmentDraft,
  completeAssessment,
  saveAssessmentDraft,
} from '@/domain/assessments/assessmentLifecycle'
import {
  reconcileAssessmentInstance,
  reconcileAssetAssessmentInstance,
  reconcileManualAssetAssessmentInstance,
  reconcileOrganizationAssessments,
} from '@/domain/assessments/reconcileAssessmentInstance'
import { POLICY_CATALOG } from '@/domain/assessments/catalog'
import { resolveInheritedAssessmentEvidence } from '@/domain/assessments/resolveInheritedEvidence'
import { withDerivedAssessmentStatus } from '@/domain/assessments/assessmentExpiration'
import { getRiskSummary } from '@/domain/assessments/getRiskSummary'

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function authenticated(req: PayloadRequest): Promise<TenantContext | Response> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
  if (!ctx.isPlatformAdmin && !ctx.organizationId) return json({ error: 'forbidden' }, 403)
  return ctx
}

async function featureEnabled(req: PayloadRequest, organizationId: string): Promise<boolean> {
  const result = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const value = result.docs[0]?.features
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.security_assessments === true
  )
}

async function loadAssessment(req: PayloadRequest, id: string) {
  return req.payload
    .findByID({ collection: 'assessment-instances', id, overrideAccess: true, req, depth: 0 })
    .catch(() => null)
}

async function loadAsset(req: PayloadRequest, asset: unknown) {
  if (!asset) return null
  return req.payload
    .findByID({ collection: 'assets', id: relationId(asset), overrideAccess: true, req, depth: 0 })
    .catch(() => null)
}

async function loadManualAsset(req: PayloadRequest, asset: unknown) {
  if (!asset) return null
  return req.payload
    .findByID({
      collection: 'non-network-assets',
      id: relationId(asset),
      overrideAccess: true,
      req,
      depth: 0,
    })
    .catch(() => null)
}

function assessmentTargetClauses(assessment: AssessmentInstance): Where[] {
  if (assessment.scope === 'organization')
    return [
      { office: { exists: false } },
      { asset: { exists: false } },
      { manual_asset: { exists: false } },
    ]
  if (assessment.scope === 'office')
    return [
      { office: { equals: relationId(assessment.office) } },
      { asset: { exists: false } },
      { manual_asset: { exists: false } },
    ]
  return assessment.manual_asset
    ? [{ manual_asset: { equals: relationId(assessment.manual_asset) } }]
    : [{ asset: { equals: relationId(assessment.asset) } }]
}

export function buildAssessmentOfficeScope(
  officeId: string,
  currentAssetIds: string[],
  currentManualAssetIds: string[]
): Where {
  return {
    or: [
      { scope: { equals: 'organization' } },
      {
        and: [{ scope: { equals: 'office' } }, { office: { equals: officeId } }],
      },
      ...(currentAssetIds.length
        ? [
            {
              and: [{ scope: { equals: 'asset' } }, { asset: { in: currentAssetIds } }],
            } as Where,
          ]
        : []),
      ...(currentManualAssetIds.length
        ? [
            {
              and: [
                { scope: { equals: 'asset' } },
                { manual_asset: { in: currentManualAssetIds } },
              ],
            } as Where,
          ]
        : []),
    ],
  }
}

export const assessmentsListEndpoint: Endpoint = {
  path: '/v1/assessments',
  method: 'get',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
    const parsed = AssessmentListQuerySchema.safeParse({
      scope: params.get('scope') ?? undefined,
      office_id: params.get('office_id') ?? undefined,
      asset_id: params.get('asset_id') ?? undefined,
    })
    if (!parsed.success) return json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
    const clauses: Where[] = []
    clauses.push({ organization: { equals: ctx.organizationId } })
    if (!ctx.isPlatformAdmin && ctx.role !== 'org_admin')
      clauses.push({
        or: [{ scope: { equals: 'organization' } }, { office: { in: ctx.officeIds } }],
      })
    if (parsed.data.scope) clauses.push({ scope: { equals: parsed.data.scope } })
    if (parsed.data.office_id) {
      const [currentAssets, currentManualAssets] = await Promise.all([
        req.payload.find({
          collection: 'assets',
          where: {
            and: [
              { organization: { equals: ctx.organizationId } },
              { office: { equals: parsed.data.office_id } },
            ],
          },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 5000,
        }),
        req.payload.find({
          collection: 'non-network-assets',
          where: {
            and: [
              { organization: { equals: ctx.organizationId } },
              { office: { equals: parsed.data.office_id } },
            ],
          },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 5000,
        }),
      ])
      const currentAssetIds = currentAssets.docs.map(asset => String(asset.id))
      const currentManualAssetIds = currentManualAssets.docs.map(asset => String(asset.id))
      clauses.push(
        buildAssessmentOfficeScope(parsed.data.office_id, currentAssetIds, currentManualAssetIds)
      )
    }
    if (parsed.data.asset_id) clauses.push({ asset: { equals: parsed.data.asset_id } })
    if (!(await featureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const result = await req.payload.find({
      collection: 'assessment-instances',
      where: clauses.length ? { and: clauses } : {},
      overrideAccess: true,
      req,
      depth: 1,
      limit: 100,
      sort: '-createdAt',
    })
    return json({ ...result, docs: result.docs.map(doc => withDerivedAssessmentStatus(doc)) })
  },
}

export const securityReviewSummaryEndpoint: Endpoint = {
  path: '/v1/security-review/summary',
  method: 'get',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    if (!(await featureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const officeId = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams.get(
      'office_id'
    )
    if (officeId && !ctx.officeIds.includes(officeId))
      return json({ error: 'office_forbidden' }, 403)
    const result = await getRiskSummary(
      req.payload,
      { organizationId: ctx.organizationId, officeId: officeId ?? undefined },
      req
    )
    return json(result.summary)
  },
}

export const assessmentDetailEndpoint: Endpoint = {
  path: '/v1/assessments/:id',
  method: 'get',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    const assessment = await loadAssessment(req, String(req.routeParams?.id))
    if (!assessment) return json({ error: 'not_found' }, 404)
    if (!canReadAssessment(ctx, assessment)) return json({ error: 'forbidden' }, 403)
    const organizationId = relationId(assessment.organization)
    if (!(await featureEnabled(req, organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const answers = await req.payload.find({
      collection: 'assessment-answers',
      where: { assessment: { equals: assessment.id } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 100,
    })
    const previousAssessment = !['pending', 'in_progress'].includes(assessment.status)
      ? null
      : (
          await req.payload.find({
            collection: 'assessment-instances',
            where: {
              and: [
                { organization: { equals: organizationId } },
                { scope: { equals: assessment.scope } },
                { policy_key: { equals: assessment.policy_key } },
                { policy_version: { equals: assessment.policy_version } },
                // 'superseded' included alongside 'completed' — reconcileAssessmentInstance
                // marks an open instance superseded (not completed) when the applicable
                // question set changes mid-review (e.g. asset_identified); its in-progress
                // answers are exactly the draft that should carry over, not just a finished one's.
                { status: { in: ['completed', 'superseded'] } },
                { id: { not_equals: assessment.id } },
                ...assessmentTargetClauses(assessment),
              ],
            },
            overrideAccess: true,
            req,
            depth: 0,
            limit: 1,
            // '-createdAt', not '-completed_at': a superseded predecessor never got a
            // completed_at, so sorting on that field would push it behind an older
            // completed one instead of picking the actual most recent instance.
            sort: '-createdAt',
          })
        ).docs[0]
    let previousAnswers = previousAssessment
      ? (
          await req.payload.find({
            collection: 'assessment-answers',
            where: { assessment: { equals: previousAssessment.id } },
            overrideAccess: true,
            req,
            depth: 0,
            limit: 100,
          })
        ).docs
      : []
    const assessmentHistory = await req.payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { organization: { equals: organizationId } },
          { scope: { equals: assessment.scope } },
          ...assessmentTargetClauses(assessment),
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 100,
      sort: '-createdAt',
    })
    if (!previousAnswers.length && ['pending', 'in_progress'].includes(assessment.status)) {
      const compatiblePrevious = assessmentHistory.docs.find(
        item =>
          String(item.id) !== String(assessment.id) &&
          (item.status === 'completed' || item.status === 'superseded') &&
          item.policy_key === assessment.policy_key &&
          item.policy_version === assessment.policy_version
      )
      if (compatiblePrevious) {
        previousAnswers = (
          await req.payload.find({
            collection: 'assessment-answers',
            where: { assessment: { equals: compatiblePrevious.id } },
            overrideAccess: true,
            req,
            depth: 0,
            limit: 100,
          })
        ).docs
      }
    }
    const effectiveEvidence = await resolveInheritedAssessmentEvidence(req.payload, assessment, req)
    const technical = assessment.asset
      ? await req.payload.find({
          collection: 'compliance-results',
          where: {
            and: [
              { asset: { equals: relationId(assessment.asset) } },
              { service_key: { exists: true } },
            ],
          },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 200,
          sort: '-evaluated_at',
        })
      : { docs: [] }
    const seenTechnical = new Set<string>()
    const technicalObservations = technical.docs.filter(result => {
      const key = `${result.check_key}:${result.service_key ?? ''}`
      if (seenTechnical.has(key)) return false
      seenTechnical.add(key)
      return true
    })
    return json({
      assessment: withDerivedAssessmentStatus(assessment),
      answers: answers.docs,
      previous_answers: previousAnswers,
      assessment_history: assessmentHistory.docs.map(item => withDerivedAssessmentStatus(item)),
      effective_evidence: effectiveEvidence,
      technical_observations: technicalObservations,
    })
  },
}

async function writableAssessment(
  req: PayloadRequest,
  ctx: TenantContext
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true
      assessment: AssessmentInstance
      asset: Asset | null
      manualAsset: NonNetworkAsset | null
    }
> {
  const assessment = await loadAssessment(req, String(req.routeParams?.id))
  if (!assessment) return { ok: false, response: json({ error: 'not_found' }, 404) }
  const asset = await loadAsset(req, assessment.asset)
  const manualAsset = await loadManualAsset(req, assessment.manual_asset)
  if (!canAnswerAssessment(ctx, assessment, asset ?? manualAsset))
    return { ok: false, response: json({ error: 'forbidden' }, 403) }
  if (!(await featureEnabled(req, relationId(assessment.organization))))
    return { ok: false, response: json({ error: 'feature_disabled' }, 403) }
  return { ok: true, assessment, asset, manualAsset }
}

export const assessmentDraftEndpoint: Endpoint = {
  path: '/v1/assessments/:id/draft',
  method: 'patch',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    const loaded = await writableAssessment(req, ctx)
    if (!loaded.ok) return loaded.response
    const parsed = SaveAssessmentDraftSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_draft', issues: parsed.error.issues }, 400)
    try {
      const answers = await saveAssessmentDraft(
        req.payload,
        String(loaded.assessment.id),
        parsed.data,
        ctx.userId,
        req
      )
      return json({ assessment_id: loaded.assessment.id, answers })
    } catch (error) {
      return json(
        {
          error: 'draft_rejected',
          message: error instanceof Error ? error.message : 'Invalid draft',
        },
        400
      )
    }
  },
}

export const assessmentCompleteEndpoint: Endpoint = {
  path: '/v1/assessments/:id/complete',
  method: 'post',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    const loaded = await writableAssessment(req, ctx)
    if (!loaded.ok) return loaded.response
    const parsed = CompleteAssessmentSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_completion', issues: parsed.error.issues }, 400)
    try {
      const assessment = await completeAssessment(
        req.payload,
        String(loaded.assessment.id),
        parsed.data,
        ctx.userId,
        req
      )
      return json(assessment)
    } catch (error) {
      return json(
        {
          error: 'completion_rejected',
          message: error instanceof Error ? error.message : 'Invalid completion',
        },
        400
      )
    }
  },
}

export const assessmentReopenEndpoint: Endpoint = {
  path: '/v1/assessments/:id/reopen',
  method: 'post',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    const loaded = await writableAssessment(req, ctx)
    if (!loaded.ok) return loaded.response
    const parsed = ReopenAssessmentSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_reopen', issues: parsed.error.issues }, 400)
    const assessment = loaded.assessment
    if (!['completed', 'expired', 'superseded'].includes(assessment.status))
      return json({ error: 'assessment_already_open' }, 409)
    const result =
      assessment.scope === 'asset' && loaded.asset
        ? await reconcileAssetAssessmentInstance(req.payload, loaded.asset, 'manual_review', req)
        : assessment.scope === 'asset' && loaded.manualAsset
          ? await reconcileManualAssetAssessmentInstance(
              req.payload,
              loaded.manualAsset,
              'manual_review',
              req
            )
          : await reconcileAssessmentInstance(
              req.payload,
              assessment.scope === 'organization'
                ? {
                    scope: 'organization',
                    id: relationId(assessment.organization),
                    organizationId: relationId(assessment.organization),
                    is_active: true,
                  }
                : {
                    scope: 'office',
                    id: relationId(assessment.office),
                    organizationId: relationId(assessment.organization),
                    is_active: true,
                  },
              'manual_review',
              req
            )
    if (['created', 'preserved'].includes(result.action) && result.id) {
      const [sourceAnswers, targetAssessment, targetAnswers] = await Promise.all([
        req.payload.find({
          collection: 'assessment-answers',
          where: { assessment: { equals: assessment.id } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 100,
        }),
        req.payload.findByID({
          collection: 'assessment-instances',
          id: result.id,
          overrideAccess: true,
          req,
          depth: 0,
        }),
        req.payload.find({
          collection: 'assessment-answers',
          where: { assessment: { equals: result.id } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 100,
        }),
      ])
      const existingQuestionKeys = new Set(targetAnswers.docs.map(answer => answer.question_key))
      const copiedDraft = buildCopiedAssessmentDraft(
        sourceAnswers.docs.filter(answer => !existingQuestionKeys.has(answer.question_key)),
        targetAssessment.question_set_snapshot
      )
      if (copiedDraft.answers.length)
        await saveAssessmentDraft(req.payload, String(result.id), copiedDraft, ctx.userId, req)
    }
    return json(result, result.action === 'created' ? 201 : 200)
  },
}

export const assessmentPolicyEndpoint: Endpoint = {
  path: '/v1/organization/assessment-policy',
  method: 'patch',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    if (ctx.role !== 'org_admin' || !ctx.organizationId) return json({ error: 'forbidden' }, 403)
    if (!(await featureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const parsed = UpdateAssessmentPolicySchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_policy', issues: parsed.error.issues }, 400)
    if (
      !POLICY_CATALOG.some(
        policy =>
          policy.key === parsed.data.policy_key && policy.version === parsed.data.policy_version
      )
    )
      return json({ error: 'policy_version_unavailable' }, 400)

    const found = await req.payload.find({
      collection: 'organization-settings',
      where: { organization: { equals: ctx.organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    })
    const settings = found.docs[0]
    if (!settings) return json({ error: 'settings_not_found' }, 404)
    if (
      settings.assessment_policy_key === parsed.data.policy_key &&
      settings.assessment_policy_version === parsed.data.policy_version
    )
      return json(settings)

    const ownsTransaction = !req.transactionID
    const transactionID = req.transactionID ?? (await req.payload.db.beginTransaction())
    Object.assign(req, { transactionID })
    try {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization, assessment policy}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {organization security review participants}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      const updated = await req.payload.update({
        collection: 'organization-settings',
        id: settings.id,
        overrideAccess: true,
        req,
        data: {
          assessment_policy_key: parsed.data.policy_key,
          assessment_policy_version: parsed.data.policy_version,
          assessment_policy_selected_at: new Date().toISOString(),
          assessment_policy_selected_by: ctx.userId,
        },
      })
      await reconcileOrganizationAssessments(req.payload, ctx.organizationId, 'policy_changed', req)
      if (ownsTransaction && transactionID) await req.payload.db.commitTransaction(transactionID)
      return json(updated)
    } catch (error) {
      if (ownsTransaction && transactionID) await req.payload.db.rollbackTransaction(transactionID)
      return json(
        {
          error: 'policy_change_failed',
          message: error instanceof Error ? error.message : 'Policy change failed',
        },
        400
      )
    }
  },
}
