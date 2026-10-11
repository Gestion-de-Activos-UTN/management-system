import type { Endpoint, PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { locationLabel } from '@/lib/argentina-geo'
import { ProfileUpdateSchema } from '@/modules/users/schema'

const json = (body: unknown, status = 200) => Response.json(body, { status })

export type MyProfile = {
  name: string
  email: string
  role: string | null
  organization: { id: string; name: string } | null
  /** El org_admin cubre todas las oficinas de la organización. */
  all_offices: boolean
  offices: Array<{ id: string; name: string; location: string | null }>
}

// Sólo personas de una organización (collection users). El admin de plataforma edita su perfil
// en endpoints/platformAdminProfile.ts.
async function currentUser(req: PayloadRequest) {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return { response: json({ error: 'unauthenticated' }, 401) }
  if (ctx.isPlatformAdmin || req.user?.collection !== 'users') {
    return { response: json({ error: 'forbidden' }, 403) }
  }
  return { ctx }
}

async function buildProfile(
  req: PayloadRequest,
  ctx: NonNullable<Awaited<ReturnType<typeof getTenantContext>>>
) {
  const [user, organization, offices] = await Promise.all([
    req.payload.findByID({
      collection: 'users',
      id: ctx.userId,
      overrideAccess: true,
      req,
      depth: 0,
    }),
    ctx.organizationId
      ? req.payload
          .findByID({
            collection: 'organizations',
            id: ctx.organizationId,
            overrideAccess: true,
            req,
            depth: 0,
          })
          .catch(() => null)
      : null,
    ctx.officeIds.length
      ? req.payload.find({
          collection: 'offices',
          where: { and: [{ id: { in: ctx.officeIds } }, { is_active: { equals: true } }] },
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
          sort: 'name',
        })
      : { docs: [] },
  ])
  return {
    name: user.name ?? '',
    email: user.email,
    role: ctx.role,
    organization: organization ? { id: String(organization.id), name: organization.name } : null,
    all_offices: ctx.role === 'org_admin',
    offices: offices.docs.map(office => ({
      id: String(office.id),
      name: office.name,
      location: locationLabel(office.province_id, office.department_id),
    })),
  } satisfies MyProfile
}

const getMyProfileEndpoint: Endpoint = {
  path: '/v1/me/profile',
  method: 'get',
  handler: async req => {
    const auth = await currentUser(req)
    if (auth.response) return auth.response
    return json(await buildProfile(req, auth.ctx))
  },
}

const updateMyProfileEndpoint: Endpoint = {
  path: '/v1/me/profile',
  method: 'patch',
  handler: async req => {
    const auth = await currentUser(req)
    if (auth.response) return auth.response
    const parsed = ProfileUpdateSchema.safeParse(await req.json!().catch(() => ({})))
    if (!parsed.success) return json({ error: 'invalid_profile', issues: parsed.error.issues }, 400)
    // AUDIT: this action must emit an AuditLogs entry (user.profile_update, chain_hash over {user, name}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.update({
      collection: 'users',
      id: auth.ctx.userId,
      data: { name: parsed.data.name },
      overrideAccess: true,
      req,
    })
    return json(await buildProfile(req, auth.ctx))
  },
}

export const myProfileEndpoints: Endpoint[] = [getMyProfileEndpoint, updateMyProfileEndpoint]
