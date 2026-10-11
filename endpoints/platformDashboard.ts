import type { Endpoint, Where } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { OFFLINE_THRESHOLD_SECONDS } from '@/domain/agents/agent-state'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export const platformDashboardEndpoint: Endpoint = {
  path: '/v1/platform-admin/dashboard',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.isPlatformAdmin || ctx.organizationId) return json({ error: 'forbidden' }, 403)

    const now = new Date()
    const nowIso = now.toISOString()
    const onlineSince = new Date(now.getTime() - OFFLINE_THRESHOLD_SECONDS * 1000).toISOString()
    const onlineAgentWhere: Where = {
      and: [
        { is_active: { equals: true } },
        { last_heartbeat_at: { greater_than_equal: onlineSince } },
        { last_heartbeat_at: { less_than_equal: nowIso } },
      ],
    }

    const [
      organizations,
      activeOrganizations,
      activeOffices,
      activeAgents,
      onlineAgents,
      incidents,
    ] = await Promise.all([
      req.payload.count({ collection: 'organizations', overrideAccess: true, req }),
      req.payload.count({
        collection: 'organizations',
        where: { is_active: { equals: true } },
        overrideAccess: true,
        req,
      }),
      req.payload.count({
        collection: 'offices',
        where: { is_active: { equals: true } },
        overrideAccess: true,
        req,
      }),
      req.payload.count({
        collection: 'agents',
        where: { is_active: { equals: true } },
        overrideAccess: true,
        req,
      }),
      req.payload.count({
        collection: 'agents',
        where: onlineAgentWhere,
        overrideAccess: true,
        req,
      }),
      req.payload.count({
        collection: 'inventory-incidents',
        where: { status: { equals: 'pending' } },
        overrideAccess: true,
        req,
      }),
    ])

    return json({
      organizations: { total: organizations.totalDocs, active: activeOrganizations.totalDocs },
      active_offices: activeOffices.totalDocs,
      agents: { active: activeAgents.totalDocs, online: onlineAgents.totalDocs },
      pending_incidents: incidents.totalDocs,
    })
  },
}
