import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { relationId } from '../lib/relationId'
import {
  getAgentLifecycleStatus,
  getAgentConnectivity,
  type AgentRevocationReason,
} from '../domain/agents/agent-state'
import { getAgentQuota, SubscriptionNotFoundError } from '../domain/subscriptions/agent-quota'
import { canDo } from '../access/rbac/permissions'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

export interface DetailedOfficeAgentSummary {
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
    revocation_reason: AgentRevocationReason | null
    last_heartbeat_at: string | null
  }>
}

export type OfficeAgentSummary = DetailedOfficeAgentSummary | { office_id: string; scanner_status: OfficeScannerStatus }

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
  if (!summary) return 'not_installed'
  if ('scanner_status' in summary) return summary.scanner_status
  if (summary.total === 0) return 'not_installed'
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
    if (!canDo(ctx.role, 'offices', 'read', ctx.organizationId)) return json({ error: 'forbidden' }, 403)
    if (!ctx.organizationId) return json({ docs: [], quota: null })

    const offices = await req.payload.find({
      collection: 'offices',
      where: {
        and: [{ organization: { equals: ctx.organizationId } }, { id: { in: ctx.officeIds } }],
      },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    })
    const officeIds = offices.docs.map(office => String(office.id))
    if (officeIds.length === 0) return json({ docs: [], quota: null })

    const agents = await req.payload.find({
      collection: 'agents',
      where: { office: { in: officeIds } },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    })
    const summary = new Map<string, DetailedOfficeAgentSummary>()
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
      const connectivity = getAgentConnectivity(agent)
      if (connectivity === 'online') current.online += 1
      else if (connectivity === 'offline') current.offline += 1
      else if (connectivity === 'pending') current.never_connected += 1
      current.agents.push({
        id: String(agent.id),
        lifecycle_status: lifecycle,
        connectivity,
        revocation_reason: agent.revocation_reason ?? null,
        last_heartbeat_at: agent.last_heartbeat_at ?? null,
      })
    }

    if (!canDo(ctx.role, 'agents', 'read', ctx.organizationId))
      return json({ docs: [...summary.values()].map(row => ({ office_id: row.office_id, scanner_status: getOfficeScannerStatus(row) })), quota: null })
    let quota
    try {
      quota = await getAgentQuota(req.payload, ctx.organizationId, req)
    } catch (err) {
      if (err instanceof SubscriptionNotFoundError) {
        return json({ docs: Array.from(summary.values()), quota: null })
      }
      throw err
    }
    return json({ docs: Array.from(summary.values()), quota })
  },
}
