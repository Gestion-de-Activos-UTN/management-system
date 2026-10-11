import type { Endpoint, PayloadRequest } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { PlatformAdminProfileSchema } from '../modules/auth/schema'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

async function currentPlatformAdmin(req: PayloadRequest) {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return { response: json({ error: 'unauthenticated' }, 401) }
  if (!ctx.isPlatformAdmin || req.user?.collection !== 'admins')
    return { response: json({ error: 'forbidden' }, 403) }
  return { ctx }
}

export const platformAdminProfileEndpoint: Endpoint = {
  path: '/v1/platform-admin-profile',
  method: 'get',
  handler: async req => {
    const auth = await currentPlatformAdmin(req)
    if (auth.response) return auth.response
    const admin = await req.payload.findByID({
      collection: 'admins',
      id: auth.ctx.userId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    return json({ name: admin.name ?? '' })
  },
}

export const updatePlatformAdminProfileEndpoint: Endpoint = {
  path: '/v1/platform-admin-profile',
  method: 'patch',
  handler: async req => {
    const auth = await currentPlatformAdmin(req)
    if (auth.response) return auth.response
    const parsed = PlatformAdminProfileSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success)
      return json({ error: 'invalid_profile', issues: parsed.error.issues }, 400)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {platform admin profile name}, previous hash for the platform scope)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const admin = await req.payload.update({
      collection: 'admins',
      id: auth.ctx.userId,
      data: { name: parsed.data.name },
      overrideAccess: true,
      req,
      depth: 0,
    })
    return json({ name: admin.name ?? '' })
  },
}
