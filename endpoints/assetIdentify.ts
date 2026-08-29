import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Confirmar (o deshacer) la identificación de un activo no reescribe el resto de los campos —
// su propio endpoint en vez de sobrecargar el PATCH genérico de assets con un flag mágico.
// Acción directa y bidireccional (org_admin/office_manager, sin flujo de aprobación este sprint).
export const assetIdentifyEndpoint: Endpoint = {
  path: '/v1/assets/:id/identify',
  method: 'patch',
  handler: async (req) => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'assets', 'update', ctx.organizationId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const id = req.routeParams?.id as string
    const existing = await req.payload
      .findByID({ collection: 'assets', id, overrideAccess: true, req, depth: 0 })
      .catch(() => null)
    if (!existing) return json({ error: 'not_found' }, 404)

    // canDo ya validó la acción en general — el filtro de fila (¿esta oficina es la del actor?)
    // es una capa aparte que nunca se salta, mismo criterio que orgScopedAccess/assertOfficeInScope.
    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOfficeInScope(relationId(existing.office), ctx.officeIds, unrestricted)
    // Defensa en profundidad (ver access/tenant/assertOrganizationMatches.ts): no confiar solo
    // en officeIds — verificar la organización real del documento antes de mutarlo.
    assertOrganizationMatches(relationId(existing.organization), ctx.organizationId, unrestricted)

    const body = (await req.json!().catch(() => ({}))) as { identified?: boolean }
    const identified = Boolean(body.identified)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, identified}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'assets',
      id,
      overrideAccess: true,
      req,
      data: { identified },
    })

    return json(updated)
  },
}
