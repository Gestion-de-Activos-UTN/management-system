import type { Endpoint, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { adminErrorResponse, organizationAdminLock } from '@/domain/organizations/admin-actions'
import { withTransaction } from '@/domain/with-transaction'
import {
  deactivateOrganization,
  organizationStatusImpact,
  reactivateOrganization,
} from '@/domain/organizations/organization-lifecycle'
import { OrganizationStatusSchema } from '@/modules/organizations/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })

// RF-25a: sólo un PlatformAdmin desactiva o reactiva una organización, y desde el panel de la
// plataforma (sin ?asOrganization=): el id viene de la ruta, nunca del contexto visitado.
async function platformAdmin(req: PayloadRequest): Promise<Response | null> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
  if (!ctx.isPlatformAdmin || ctx.organizationId) return json({ error: 'forbidden' }, 403)
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

export const platformOrganizationEndpoints: Endpoint[] = [
  organizationStatusImpactEndpoint,
  organizationStatusEndpoint,
]
