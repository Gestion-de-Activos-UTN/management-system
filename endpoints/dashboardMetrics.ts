import type { Endpoint, Where } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'

const HEARTBEAT_INTERVAL_SECONDS = 300
const OFFLINE_THRESHOLD_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2

export interface DashboardMetrics {
  total_assets: number
  active_offices: number
  online_scanners: number
  last_scan_at: string | null
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

function isOnline(lastHeartbeatAt: string | null | undefined): boolean {
  if (!lastHeartbeatAt) return false
  return (Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000 <= OFFLINE_THRESHOLD_SECONDS
}

function requestedOfficeId(req: Parameters<Endpoint['handler']>[0]): string | null {
  if (!req.url) return null
  return new URL(req.url, 'http://localhost').searchParams.get('office_id')
}

export const dashboardMetricsEndpoint: Endpoint = {
  path: '/v1/dashboard/metrics',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ error: 'organization_required' }, 400)

    const officeId = requestedOfficeId(req)
    if (officeId && !ctx.officeIds.includes(officeId)) {
      return json({ error: 'office_forbidden' }, 403)
    }
    const officeIds = officeId ? [officeId] : ctx.officeIds
    if (officeIds.length === 0) {
      return json({ total_assets: 0, active_offices: 0, online_scanners: 0, last_scan_at: null })
    }

    const officeWhere: Where = {
      and: [{ organization: { equals: ctx.organizationId } }, { id: { in: officeIds } }],
    }
    const offices = await req.payload.find({
      collection: 'offices',
      where: officeWhere,
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1000,
    })
    const scopedOfficeIds = offices.docs.map(office => String(office.id))
    if (scopedOfficeIds.length === 0) {
      return json({ total_assets: 0, active_offices: 0, online_scanners: 0, last_scan_at: null })
    }

    const [assets, scans, agents] = await Promise.all([
      req.payload.find({
        collection: 'assets',
        where: { office: { in: scopedOfficeIds } },
        overrideAccess: true,
        req,
        depth: 0,
        limit: 1,
      }),
      req.payload.find({
        collection: 'scan-reports',
        where: {
          and: [{ office: { in: scopedOfficeIds } }, { status: { equals: 'processed' } }],
        },
        overrideAccess: true,
        req,
        depth: 0,
        limit: 1,
        sort: '-processed_at',
      }),
      req.payload.find({
        collection: 'agents',
        where: { office: { in: scopedOfficeIds }, is_active: { equals: true } },
        overrideAccess: true,
        req,
        depth: 0,
        limit: 5000,
      }),
    ])

    return json({
      total_assets: assets.totalDocs,
      active_offices: offices.docs.filter(office => office.is_active).length,
      online_scanners: agents.docs.filter(agent => isOnline(agent.last_heartbeat_at)).length,
      last_scan_at: scans.docs[0]?.processed_at ?? null,
    } satisfies DashboardMetrics)
  },
}
