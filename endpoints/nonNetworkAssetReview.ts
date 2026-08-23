import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope, computeNextReviewAt } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { findReviewPolicy } from '../collections/NonNetworkAssets/hooks/resolveTenant'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// RF-53a: confirmar una revisión no debe exigir reescribir el resto de los campos — es su propio
// endpoint en vez de sobrecargar el PATCH genérico de non-network-assets con un flag mágico.
export const nonNetworkAssetReviewEndpoint: Endpoint = {
  path: '/v1/non-network-assets/:id/review',
  method: 'patch',
  handler: async (req) => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'non-network-assets', 'update', ctx.organizationId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const id = req.routeParams?.id as string
    const existing = await req.payload
      .findByID({ collection: 'non-network-assets', id, overrideAccess: true, req, depth: 0 })
      .catch(() => null)
    if (!existing) return json({ error: 'not_found' }, 404)

    // canDo ya validó la acción en general — el filtro de fila (¿esta oficina es la del actor?)
    // es una capa aparte que nunca se salta, mismo criterio que orgScopedAccess/assertOfficeInScope.
    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOfficeInScope(relationId(existing.office), ctx.officeIds, unrestricted)
    // Defensa en profundidad (ver access/tenant/assertOrganizationMatches.ts): no confiar solo
    // en officeIds — verificar la organización real del documento antes de mutarlo.
    assertOrganizationMatches(relationId(existing.organization), ctx.organizationId, unrestricted)

    const policy = await findReviewPolicy(req, relationId(existing.organization))
    const nextReviewAt = computeNextReviewAt(policy, existing.asset_category ?? null, new Date())

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, last_reviewed_at, next_review_at}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'non-network-assets',
      id,
      overrideAccess: true,
      req,
      data: {
        last_reviewed_at: new Date().toISOString(),
        next_review_at: nextReviewAt,
      },
    })

    return json(updated)
  },
}
