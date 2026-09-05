import type { Endpoint } from 'payload'
import { canDo } from '../access/rbac/permissions'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { assertOfficeInScope } from '../collections/NonNetworkAssets/invariants'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const agentRevokeEndpoint: Endpoint = {
  path: '/v1/agents/:id/revoke',
  method: 'post',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'agents', 'update', ctx.organizationId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const id = req.routeParams?.id as string
    const agent = await req.payload
      .findByID({ collection: 'agents', id, overrideAccess: true, req, depth: 0 })
      .catch(() => null)
    if (!agent) return json({ error: 'not_found' }, 404)

    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    assertOrganizationMatches(relationId(agent.organization), ctx.organizationId, unrestricted)
    assertOfficeInScope(relationId(agent.office), ctx.officeIds, unrestricted)

    if (agent.lifecycle_status === 'revoked' || !agent.is_active) return json(agent)

    const revokedAt = new Date().toISOString()
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent, organization, office, revoked_at}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: this event should trigger a Notification Bell entry for {org_admins of this organization}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    const updated = await req.payload.update({
      collection: 'agents',
      id,
      overrideAccess: true,
      req,
      data: { lifecycle_status: 'revoked', is_active: false, revoked_at: revokedAt },
    })
    return json(updated)
  },
}
