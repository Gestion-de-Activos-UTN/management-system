import type { Endpoint } from 'payload'
import { getTenantContext } from '../access/tenant/resolveTenantContext'
import { relationId } from '../lib/relationId'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// No abre Users.read (esa colección sigue () => false a propósito — ver el ponytail: marcado en
// app/portal/(protected)/admin/users/page.tsx, es una brecha aparte, no de este módulo). Esto
// expone solo lo mínimo que un selector de `owner` (Assets/NonNetworkAssets, RF-51a) necesita:
// id/name/email de los miembros activos de la organización del actor, vía OrganizationMemberships
// (la bridge table real, SYSTEM_PROMPT.md §7) con overrideAccess, nunca abriendo el REST de Users.
export const orgMembersEndpoint: Endpoint = {
  path: '/v1/org-members',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (!ctx.organizationId) return json({ docs: [] })

    const memberships = await req.payload.find({
      collection: 'organization-memberships',
      where: { organization: { equals: ctx.organizationId }, is_active: { equals: true } },
      overrideAccess: true,
      req,
      depth: 2,
      limit: 500,
    })

    const docs = memberships.docs.map(m => {
      const user = m.user as unknown as { id: string; name: string; email: string }
      const role = m.role as unknown as { slug: string } | string
      return {
        id: relationId(user),
        name: user.name,
        email: user.email,
        role: typeof role === 'string' ? role : role.slug,
        status: m.status,
      }
    })

    return json({ docs })
  },
}
