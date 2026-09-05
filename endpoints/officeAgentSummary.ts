import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { relationId } from '../lib/relationId'
import { isOnline } from '../lib/agentStatus'
import { getAgentLifecycleStatus } from '../domain/agents/agent-state'
import { getAgentQuota } from '../domain/subscriptions/agent-quota'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export interface OfficeAgentSummary {
  office_id: string
  total: number
  active: number
  online: number
  offline: number
  never_connected: number
  agents: Array<{
    id: string
    lifecycle_status: 'provisioned' | 'active' | 'revoked'
    connectivity: 'online' | 'offline' | 'pending' | 'revoked'
    last_heartbeat_at: string | null
  }>
}

export interface AgentQuotaSummary {
  limit: number
  used: number
  available: number
  per_office: number | null
}

export type OfficeScannerStatus = 'not_installed' | 'pending' | 'online' | 'offline' | 'inactive'

export function getOfficeScannerStatus(
  summary: OfficeAgentSummary | undefined
): OfficeScannerStatus {
  if (!summary || summary.total === 0) return 'not_installed'
  if (summary.active === 0) return 'inactive'
  if (summary.online > 0) return 'online'
  if (summary.never_connected === summary.active) return 'pending'
  return 'offline'
}

export const officeAgentSummaryEndpoint: Endpoint = {
  path: '/v1/offices/agent-summary',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ docs: [], quota: null })

    const offices = await req.payload.find({
      collection: 'offices',
      where: {
        and: [{ organization: { equals: ctx.organizationId } }, { id: { in: ctx.officeIds } }],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1000,
    })
    const officeIds = offices.docs.map(office => String(office.id))
    if (officeIds.length === 0) return json({ docs: [], quota: null })

    const agents = await req.payload.find({
      collection: 'agents',
      where: { office: { in: officeIds } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
    })
    const summary = new Map<string, OfficeAgentSummary>()
    for (const officeId of officeIds) {
      summary.set(officeId, {
        office_id: officeId,
        total: 0,
        active: 0,
        online: 0,
        offline: 0,
        never_connected: 0,
        agents: [],
      })
    }

    for (const agent of agents.docs) {
      const officeId = relationId(agent.office)
      const current = summary.get(officeId)
      if (!current) continue
      current.total += 1
      const lifecycle = getAgentLifecycleStatus(agent)
      if (lifecycle !== 'revoked') current.active += 1
      const connectivity =
        lifecycle === 'revoked'
          ? 'revoked'
          : !agent.last_heartbeat_at
            ? 'pending'
            : isOnline(agent.last_heartbeat_at)
              ? 'online'
              : 'offline'
      if (connectivity === 'online') current.online += 1
      else if (connectivity === 'offline') current.offline += 1
      else if (connectivity === 'pending') current.never_connected += 1
      current.agents.push({
        id: String(agent.id),
        lifecycle_status: lifecycle,
        connectivity,
        last_heartbeat_at: agent.last_heartbeat_at ?? null,
      })
    }

    const quota = await getAgentQuota(req.payload, ctx.organizationId, req)
    return json({ docs: Array.from(summary.values()), quota })
  },
}
