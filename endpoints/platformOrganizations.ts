import type { Endpoint, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { isAgentOnline } from '@/domain/agents/agent-state'
import {
  AdminDomainError,
  adminErrorResponse,
  organizationAdminLock,
} from '@/domain/organizations/admin-actions'
import { createOrgWithAdmin } from '@/domain/organizations/createOrgWithAdmin'
import { createMember } from '@/domain/organizations/member-admin'
import { updateOrganizationDetails } from '@/domain/organizations/update-organization-details'
import { withTransaction } from '@/domain/with-transaction'
import {
  deactivateOrganization,
  organizationStatusImpact,
  reactivateOrganization,
} from '@/domain/organizations/organization-lifecycle'
import {
  OrganizationCreateSchema,
  OrganizationDetailsSchema,
  OrganizationStatusSchema,
  PlatformOrgAdminCreateSchema,
} from '@/modules/organizations/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })

// RF-25a: sólo un PlatformAdmin desactiva o reactiva una organización, y desde el panel de la
// plataforma (sin ?asOrganization=): el id viene de la ruta, nunca del contexto visitado.
async function platformAdmin(req: PayloadRequest): Promise<Response | null> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
  if (!ctx.isPlatformAdmin || ctx.organizationId) return json({ error: 'forbidden' }, 403)
  return null
}

const organizationOperationalSummaryEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/operational-summary',
  method: 'get',
  handler: async req => {
    const denied = await platformAdmin(req)
    if (denied) return denied

    const officeCounts: Record<string, number> = {}
    const agentCounts: Record<string, { active: number; online: number }> = {}

    let officePage = 1
    let hasMoreOffices = true
    while (hasMoreOffices) {
      const offices = await req.payload.find({
        collection: 'offices',
        where: { is_active: { equals: true } },
        depth: 0,
        limit: 1000,
        page: officePage,
        select: { organization: true },
        overrideAccess: true,
        req,
      })

      for (const office of offices.docs) {
        const organizationId = relationId(office.organization)
        if (organizationId) {
          officeCounts[organizationId] = (officeCounts[organizationId] ?? 0) + 1
        }
      }

      hasMoreOffices = offices.hasNextPage
      officePage += 1
    }

    let agentPage = 1
    let hasMoreAgents = true
    while (hasMoreAgents) {
      const agents = await req.payload.find({
        collection: 'agents',
        where: { is_active: { equals: true } },
        depth: 0,
        limit: 1000,
        page: agentPage,
        select: { organization: true, last_heartbeat_at: true },
        overrideAccess: true,
        req,
      })

      for (const agent of agents.docs) {
        const organizationId = relationId(agent.organization)
        if (!organizationId) continue
        const counts = (agentCounts[organizationId] ??= { active: 0, online: 0 })
        counts.active += 1
        if (isAgentOnline({ last_heartbeat_at: agent.last_heartbeat_at })) counts.online += 1
      }

      hasMoreAgents = agents.hasNextPage
      agentPage += 1
    }

    return json({ counts: { offices: officeCounts, agents: agentCounts } })
  },
}

const createOrganizationEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations',
  method: 'post',
  handler: async req => {
    const denied = await platformAdmin(req)
    if (denied) return denied
    const parsed = OrganizationCreateSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_organization', issues: parsed.error.issues }, 400)

    try {
      const created = await createOrgWithAdmin(
        req.payload,
        {
          organizationName: parsed.data.name,
          industry: parsed.data.industry,
          industryDetails: parsed.data.industry_details,
          plan: parsed.data.plan,
          adminEmail: parsed.data.first_admin.email,
          adminPassword: parsed.data.first_admin.password,
          adminName: parsed.data.first_admin.name,
          officeName: parsed.data.first_office.name,
          officeProvinceId: parsed.data.first_office.province_id,
          officeDepartmentId: parsed.data.first_office.department_id,
        },
        req
      )
      return json(
        {
          id: String(created.organization.id),
          name: created.organization.name,
          is_active: true,
          plan: parsed.data.plan,
          office: { id: String(created.office.id), name: created.office.name },
          first_admin: {
            id: String(created.user.id),
            name: created.user.name,
            email: created.user.email,
            role: 'org_admin',
          },
        },
        201
      )
    } catch (error) {
      return adminErrorResponse(error)
    }
  },
}

const createOrganizationAdminEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/:id/org-admins',
  method: 'post',
  handler: async req => {
    const denied = await platformAdmin(req)
    if (denied) return denied
    const parsed = PlatformOrgAdminCreateSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_member', issues: parsed.error.issues }, 400)

    const organizationId = String(req.routeParams?.id ?? '')
    if (!organizationId) return json({ error: 'organization_not_found' }, 404)
    const platformContext = await getTenantContext(req)
    if (!platformContext) return json({ error: 'unauthenticated' }, 401)
    const organizationContext = {
      ...platformContext,
      role: 'org_admin' as const,
      organizationId,
      officeIds: [],
      selectedOfficeId: null,
    }

    try {
      const created = await withTransaction(
        req.payload,
        req,
        () =>
          createMember(req, organizationContext, {
            ...parsed.data,
            role: 'org_admin',
            office_ids: [],
          }),
        { lockKey: organizationAdminLock(organizationId) }
      )
      return json(
        {
          id: String(created.user.id),
          name: created.user.name,
          email: created.user.email,
          role: 'org_admin',
        },
        201
      )
    } catch (error) {
      return adminErrorResponse(error)
    }
  },
}

function relationId(relation: unknown): string | null {
  if (typeof relation === 'string' || typeof relation === 'number') return String(relation)
  if (relation && typeof relation === 'object' && 'id' in relation) {
    const id = relation.id
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null
  }
  return null
}

async function handle(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (error) {
    return adminErrorResponse(error)
  }
}

const organizationStatusImpactEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/:id/status-impact',
  method: 'get',
  handler: req =>
    handle(async () => {
      const denied = await platformAdmin(req)
      if (denied) return denied
      return json(await organizationStatusImpact(req, String(req.routeParams?.id ?? '')))
    }),
}

const organizationStatusEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/:id/status',
  method: 'post',
  handler: req =>
    handle(async () => {
      const denied = await platformAdmin(req)
      if (denied) return denied
      const parsed = OrganizationStatusSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_status', issues: parsed.error.issues }, 400)
      const organizationId = String(req.routeParams?.id ?? '')
      const status = parsed.data
      await withTransaction(
        req.payload,
        req,
        () =>
          status.is_active
            ? reactivateOrganization(req, organizationId)
            : deactivateOrganization(req, organizationId, status),
        { lockKey: organizationAdminLock(organizationId) }
      )
      return json({ ok: true })
    }),
}

const updateOrganizationDetailsEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/:id',
  method: 'patch',
  handler: req =>
    handle(async () => {
      const denied = await platformAdmin(req)
      if (denied) return denied
      const parsed = OrganizationDetailsSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_organization', issues: parsed.error.issues }, 400)
      const id = String(req.routeParams?.id ?? '')
      await withTransaction(
        req.payload,
        req,
        () => updateOrganizationDetails(req, id, parsed.data),
        { lockKey: organizationAdminLock(id) }
      )
      return json({ ok: true })
    }),
}

const organizationDetailsEndpoint: Endpoint = {
  path: '/v1/platform-admin/organizations/:id',
  method: 'get',
  handler: req =>
    handle(async () => {
      const denied = await platformAdmin(req)
      if (denied) return denied
      const id = String(req.routeParams?.id ?? '')
      const organizations = await req.payload.find({
        collection: 'organizations',
        where: { id: { equals: id } },
        depth: 0,
        limit: 1,
        overrideAccess: true,
        req,
      })
      if (!organizations.docs[0]) throw new AdminDomainError('not_found', 404)
      const settings = await req.payload.find({
        collection: 'organization-settings',
        where: { organization: { equals: id } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (!settings.docs[0]) throw new AdminDomainError('organization_settings_missing', 409)
      return json({
        name: organizations.docs[0].name,
        industry: settings.docs[0].industry,
        industry_details: settings.docs[0].industry_details ?? '',
      })
    }),
}

export const platformOrganizationEndpoints: Endpoint[] = [
  organizationOperationalSummaryEndpoint,
  createOrganizationEndpoint,
  updateOrganizationDetailsEndpoint,
  organizationDetailsEndpoint,
  createOrganizationAdminEndpoint,
  organizationStatusImpactEndpoint,
  organizationStatusEndpoint,
]
