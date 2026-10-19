import type { Endpoint, PayloadRequest } from 'payload'
import { canDo, type Action } from '@/access/rbac/permissions'
import { getTenantContext, type TenantContext } from '@/access/tenant/resolveTenantContext'
import { adminErrorResponse, organizationAdminLock } from '@/domain/organizations/admin-actions'
import { withTransaction } from '@/domain/with-transaction'
import {
  createOffice,
  deactivateOffice,
  loadOrganizationOffice,
  officeDeactivationImpact,
  reactivateOffice,
  updateOfficeDetails,
} from '@/domain/offices/office-lifecycle'
import { OfficeInputSchema, OfficeStatusSchema } from '@/modules/offices/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function officeAdmin(
  req: PayloadRequest,
  action: Action
): Promise<(TenantContext & { organizationId: string }) | Response> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
  if (!ctx.organizationId || !canDo(ctx.role, 'offices', action, ctx.organizationId)) {
    return json({ error: 'forbidden' }, 403)
  }
  return ctx as TenantContext & { organizationId: string }
}

async function handle(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (error) {
    return adminErrorResponse(error)
  }
}

const createOfficeEndpoint: Endpoint = {
  path: '/v1/offices',
  method: 'post',
  handler: req =>
    handle(async () => {
      const ctx = await officeAdmin(req, 'create')
      if (ctx instanceof Response) return ctx
      const parsed = OfficeInputSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_office', issues: parsed.error.issues }, 400)
      const office = await withTransaction(
        req.payload,
        req,
        () => createOffice(req, ctx.organizationId, parsed.data),
        { lockKey: organizationAdminLock(ctx.organizationId) }
      )
      return json(office, 201)
    }),
}

const updateOfficeEndpoint: Endpoint = {
  path: '/v1/offices/:id',
  method: 'patch',
  handler: req =>
    handle(async () => {
      const ctx = await officeAdmin(req, 'update')
      if (ctx instanceof Response) return ctx
      const parsed = OfficeInputSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_office', issues: parsed.error.issues }, 400)
      const office = await loadOrganizationOffice(
        req,
        ctx.organizationId,
        String(req.routeParams?.id ?? '')
      )
      return json(await updateOfficeDetails(req, office, parsed.data))
    }),
}

const officeImpactEndpoint: Endpoint = {
  path: '/v1/offices/:id/deactivation-impact',
  method: 'get',
  handler: req =>
    handle(async () => {
      const ctx = await officeAdmin(req, 'update')
      if (ctx instanceof Response) return ctx
      const office = await loadOrganizationOffice(
        req,
        ctx.organizationId,
        String(req.routeParams?.id ?? '')
      )
      return json(await officeDeactivationImpact(req, ctx.organizationId, office))
    }),
}

const officeStatusEndpoint: Endpoint = {
  path: '/v1/offices/:id/status',
  method: 'post',
  handler: req =>
    handle(async () => {
      const ctx = await officeAdmin(req, 'update')
      if (ctx instanceof Response) return ctx
      const parsed = OfficeStatusSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_status', issues: parsed.error.issues }, 400)
      const officeId = String(req.routeParams?.id ?? '')
      const status = parsed.data
      // La oficina se lee dentro de la transacción (deactivateOffice/reactivateOffice).
      await withTransaction(
        req.payload,
        req,
        () =>
          status.is_active
            ? reactivateOffice(req, ctx.organizationId, officeId)
            : deactivateOffice(req, ctx.organizationId, officeId, status),
        { lockKey: organizationAdminLock(ctx.organizationId) }
      )
      return json({ ok: true })
    }),
}

export const officeEndpoints: Endpoint[] = [
  createOfficeEndpoint,
  updateOfficeEndpoint,
  officeImpactEndpoint,
  officeStatusEndpoint,
]
