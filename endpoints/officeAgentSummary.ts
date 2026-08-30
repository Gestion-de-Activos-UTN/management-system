import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { relationId } from '../lib/relationId'
import { isOnline } from '../lib/agentStatus'

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
    if (!ctx.organizationId) return json({ docs: [] })

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
    if (officeIds.length === 0) return json({ docs: [] })

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
      })
    }

    for (const agent of agents.docs) {
      const officeId = relationId(agent.office)
      const current = summary.get(officeId)
      if (!current) continue
      current.total += 1
      if (agent.is_active) current.active += 1
      if (isOnline(agent.last_heartbeat_at)) current.online += 1
      else if (agent.last_heartbeat_at) current.offline += 1
      else current.never_connected += 1
    }

    return json({ docs: Array.from(summary.values()) })
  },
}
