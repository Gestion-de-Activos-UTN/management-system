import type { Endpoint } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo } from '@/access/rbac/permissions'
import { assertOrganizationMatches } from '@/access/tenant/assertOrganizationMatches'
import { assertOfficeInScope } from '@/collections/NonNetworkAssets/invariants'
import { relationId } from '@/lib/relationId'
import { AssetBusinessUpdateSchema } from '@/modules/assets/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })

export const assetBusinessEndpoint: Endpoint = {
  path: '/v1/assets/:id/business',
  method: 'patch',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'assets', 'update', ctx.organizationId))
      return json({ error: 'forbidden' }, 403)

    const id = String(req.routeParams?.id)
    const existing = await req.payload
      .findByID({ collection: 'assets', id, overrideAccess: true, req, depth: 0 })
      .catch(() => null)
    if (!existing) return json({ error: 'not_found' }, 404)
    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOfficeInScope(relationId(existing.office), ctx.officeIds, unrestricted)
    assertOrganizationMatches(relationId(existing.organization), ctx.organizationId, unrestricted)
    const parsed = AssetBusinessUpdateSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return json(
        { error: 'invalid_business_data', issues: parsed.success ? [] : parsed.error.issues },
        400
      )

    const assessmentScopeFields = new Set([
      'assessment_scope',
      'assessment_exclusion_reason',
      'assessment_exclusion_note',
      'assessment_excluded_until',
    ])
    if (
      existing.identification_status !== 'confirmed' &&
      Object.keys(parsed.data).some(field => !assessmentScopeFields.has(field))
    )
      return json({ error: 'asset_not_identified' }, 409)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {asset, business fields, authorization_status, assessment scope and exclusion}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'assets',
      id,
      overrideAccess: true,
      req,
      data: parsed.data,
    })
    return json(updated)
  },
}
