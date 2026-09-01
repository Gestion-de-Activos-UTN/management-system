import crypto from 'node:crypto'
import type { Endpoint } from 'payload'
import { canDo } from '../access/rbac/permissions'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { assertOrganizationMatches } from '../access/tenant/assertOrganizationMatches'
import { relationId } from '../lib/relationId'
import { buildAgentPackage, isAgentPlatform } from '../domain/agents/buildAgentPackage'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const agentProvisioningEndpoint: Endpoint = {
  path: '/v1/agents/provision',
  method: 'post',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!canDo(ctx.role, 'agents', 'create', ctx.organizationId)) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json!().catch(() => ({}))
    const officeId = typeof body?.office_id === 'string' ? body.office_id : ''
    if (!officeId) return json({ error: 'office_id es requerido' }, 400)

    // Opcional a propósito: un cliente anterior al soporte Windows no manda el campo y sigue
    // recibiendo el paquete POSIX.
    const platform = body?.platform ?? 'posix'
    if (!isAgentPlatform(platform)) return json({ error: 'platform_invalid' }, 400)

    const unrestricted = ctx.isPlatformAdmin && !ctx.organizationId
    const office = await req.payload
      .findByID({
        collection: 'offices',
        id: officeId,
        overrideAccess: true,
        req,
        depth: 0,
      })
      .catch(() => null)
    if (!office || !office.is_active) return json({ error: 'office_not_available' }, 404)
    assertOrganizationMatches(relationId(office.organization), ctx.organizationId, unrestricted)

    const agentId = `agent-${crypto.randomUUID()}`
    const platformToken = crypto.randomBytes(32).toString('base64url')
    const platformUrl = `${new URL(req.url || 'http://localhost').origin}/api/v1/reports`
    const heartbeatUrl = `${new URL(req.url || 'http://localhost').origin}/api/v1/heartbeat`

    const packageBytes = await buildAgentPackage({
      agentId,
      platformToken,
      platformUrl,
      heartbeatUrl,
      platform,
    })

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent, office, organization}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.create({
      collection: 'agents',
      overrideAccess: true,
      req,
      data: {
        id: agentId,
        office: office.id,
        is_active: true,
      },
      context: { provisionApiKey: platformToken },
    })

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent, office, organization, package_hash}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    return new Response(packageBytes as BodyInit, {
      status: 201,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${agentId}-${platform}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  },
}
