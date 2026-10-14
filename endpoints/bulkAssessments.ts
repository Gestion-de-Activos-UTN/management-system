import type { Endpoint } from 'payload'
import { hasOrgWideScope } from '@/access/rbac/permissions'
import {
  BulkAssessmentCompleteSchema,
  BulkAssessmentPreviewSchema,
  type BulkAssessmentSelector,
} from '@/modules/assessments/schema'
import {
  completeBulkAssessments,
  resolveBulkAssessmentPreview,
} from '@/domain/assessments/bulkAssessmentLifecycle'
import { authenticated, featureEnabled } from './assessments'

const json = (body: unknown, status = 200) => Response.json(body, { status })

function selectorAllowed(
  ctx: Awaited<ReturnType<typeof authenticated>>,
  selector: BulkAssessmentSelector
) {
  if (ctx instanceof Response) return false
  if (ctx.isPlatformAdmin) return false
  if (selector.mode === 'organization') return ctx.role === 'org_admin'
  if (selector.mode === 'office') {
    return (
      ctx.role === 'org_admin' ||
      (ctx.role === 'office_manager' && ctx.officeIds.includes(selector.office_id))
    )
  }
  return (
    hasOrgWideScope(ctx.role) ||
    ctx.role === 'office_manager' ||
    (ctx.role === 'org_viewer' && selector.owner_id === ctx.userId)
  )
}

export const bulkAssessmentPreviewEndpoint: Endpoint = {
  path: '/v1/assessments/bulk/preview',
  method: 'post',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    if (!(await featureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const parsed = BulkAssessmentPreviewSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_bulk_preview', issues: parsed.error.issues }, 400)
    if (!selectorAllowed(ctx, parsed.data.selector)) return json({ error: 'forbidden' }, 403)
    try {
      return json(await resolveBulkAssessmentPreview(req.payload, ctx, parsed.data.selector, req))
    } catch (error) {
      return json(
        {
          error: 'bulk_preview_failed',
          message: error instanceof Error ? error.message : 'Bulk preview failed',
        },
        400
      )
    }
  },
}

export const bulkAssessmentCompleteEndpoint: Endpoint = {
  // This specific route must be registered before /v1/assessments/:id/complete in payload.config.
  // Payload matches custom endpoints in registration order.
  path: '/v1/assessments/bulk/complete',
  method: 'post',
  handler: async req => {
    const ctx = await authenticated(req)
    if (ctx instanceof Response) return ctx
    if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
    if (!(await featureEnabled(req, ctx.organizationId)))
      return json({ error: 'feature_disabled' }, 403)
    const parsed = BulkAssessmentCompleteSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_bulk_completion', issues: parsed.error.issues }, 400)
    if (!selectorAllowed(ctx, parsed.data.selector)) return json({ error: 'forbidden' }, 403)
    try {
      return json(await completeBulkAssessments(req.payload, ctx, parsed.data, ctx.userId, req))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bulk completion failed'
      const stale = ['bulk_preview_stale', 'bulk_selection_stale'].includes(message)
      return json(
        {
          error: stale ? message : 'bulk_completion_failed',
          message: stale
            ? 'La selección cambió mientras respondías. Vuelve a revisar los activos incluidos.'
            : message,
        },
        stale ? 409 : 400
      )
    }
  },
}
