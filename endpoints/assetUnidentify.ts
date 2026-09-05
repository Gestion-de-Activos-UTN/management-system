import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { canDo } from '../access/rbac/permissions'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Revierte una identificación confirmada por error o que dejó de ser válida. A propósito NO toca
// alias/location/criticality/owner/confirmed_type/authorization_status: esos valores quedan en el
// documento (sirven para prepopular si se vuelve a identificar) pero dejan de contar en cualquier
// cálculo que filtre por `identified`/`identification_status === 'confirmed'` (ver
// domain/inventories/createInventorySnapshot.ts). rejectBusinessEditsBeforeIdentified no bloquea
// este PATCH porque ningún GATED_FIELD viaja en el body.
export const assetUnidentifyEndpoint: Endpoint = {
  path: '/v1/assets/:id/unidentify',
  method: 'patch',
  handler: async req => {
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

    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOfficeInScope(relationId(existing.office), ctx.officeIds, unrestricted)
    assertOrganizationMatches(relationId(existing.organization), ctx.organizationId, unrestricted)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, identification_status: 'pending'}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const updated = await req.payload.update({
      collection: 'assets',
      id,
      overrideAccess: true,
      req,
      data: {
        identified: false,
        identification_status: 'pending',
      },
    })

    return json(updated)
  },
}
