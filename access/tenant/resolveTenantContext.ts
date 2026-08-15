import type { Payload, PayloadRequest } from 'payload'
import type { RoleSlug } from '../rbac/permissions'
import { payloadNativeIdentityProvider, type ResolvedIdentity } from './identityProvider'
import { relationId } from '@/lib/relationId'

export class TenantResolutionError extends Error {}

export interface TenantContext {
  userId: string
  role: RoleSlug | null
  organizationId: string | null
  officeIds: string[]
  selectedOfficeId: string | null
  isPlatformAdmin: boolean
  isActive: boolean
}

export interface TenantResolverDeps {
  findActiveAdminById: (id: string) => Promise<{ isActive: boolean } | null>
  findActiveMembershipByUserId: (userId: string) => Promise<{
    organization: string
    offices: string[]
    role: { slug: RoleSlug; rank: number }
    is_active: boolean
  } | null>
  organizationExists: (id: string) => Promise<boolean>
  findOfficeIdsByOrganization: (organizationId: string) => Promise<string[]>
}

// Capa 2 (doc 02 §4): recibe una ResolvedIdentity ya resuelta por la Capa 1 (identityProvider.ts),
// nunca un req.user crudo de Payload — no conoce el mecanismo de auth.
export async function resolveTenantContext(
  identity: ResolvedIdentity | null,
  deps: TenantResolverDeps,
  requestedOrganizationId?: string | null, // ?asOrganization=<id> — solo tiene efecto para platform_admin
): Promise<TenantContext | null> {
  if (!identity) return null // fail-closed: sin sesión, sin fallback

  if (identity.collection === 'admins') {
    // findActiveAdminById y organizationExists son lecturas independientes — se disparan en
    // paralelo (organizationExists no depende de admin, solo del query param).
    const [admin, orgExists] = await Promise.all([
      deps.findActiveAdminById(identity.externalId),
      requestedOrganizationId ? deps.organizationExists(requestedOrganizationId) : Promise.resolve(null),
    ])
    if (!admin) return null

    let organizationId: string | null = null
    let officeIds: string[] = []
    if (requestedOrganizationId) {
      if (!orgExists) throw new TenantResolutionError('asOrganization inválido: la organización no existe')
      organizationId = requestedOrganizationId
      // "Visitar" una organización debe verse igual que un org_admin logueado (offices
      // reales de esa org para el OfficeSelector, no un array vacío) — ver frontend
      // isEffectiveOrgAdmin en modules/auth/hooks/use-tenant-context.ts.
      officeIds = await deps.findOfficeIdsByOrganization(organizationId)
    }

    return {
      userId: identity.externalId,
      role: 'platform_admin',
      organizationId,
      officeIds,
      selectedOfficeId: officeIds[0] ?? null,
      isPlatformAdmin: true,
      isActive: admin.isActive,
    }
  }

  // Re-derivado en cada llamada, nunca cacheado entre requests: si la membership se
  // desactivó, esta query ya no la encuentra — el JWT sigue siendo válido pero deja de
  // resolver contexto (doc 04 regla 5, ciclo de vida de membership desactivada).
  const membership = await deps.findActiveMembershipByUserId(identity.externalId)
  if (!membership) return null

  return {
    userId: identity.externalId,
    role: membership.role.slug,
    organizationId: membership.organization,
    officeIds: membership.offices,
    selectedOfficeId: membership.offices[0] ?? null,
    isPlatformAdmin: false,
    isActive: membership.is_active,
  }
}

export function createPayloadTenantResolverDeps(payload: Payload): TenantResolverDeps {
  return {
    async findActiveAdminById(id) {
      const admin = await payload
        .findByID({ collection: 'admins', id, overrideAccess: true, depth: 0 })
        .catch(() => null)
      if (!admin) return null
      return { isActive: admin.status === 'active' }
    },
    async findActiveMembershipByUserId(userId) {
      const result = await payload.find({
        collection: 'organization-memberships',
        where: { user: { equals: userId }, is_active: { equals: true } },
        overrideAccess: true,
        depth: 1, // necesario para poblar role.slug/role.rank, no solo el id
        limit: 1,
      })
      const doc = result.docs[0]
      if (!doc) return null
      const role = doc.role as unknown as { slug: RoleSlug; rank: number }
      return {
        organization: relationId(doc.organization),
        offices: ((doc.offices ?? []) as unknown[]).map(relationId),
        role: { slug: role.slug, rank: role.rank },
        is_active: Boolean(doc.is_active),
      }
    },
    async organizationExists(id) {
      const result = await payload.find({
        collection: 'organizations',
        where: { id: { equals: id } },
        overrideAccess: true,
        depth: 0,
        limit: 1,
      })
      return result.docs.length > 0
    },
    async findOfficeIdsByOrganization(organizationId) {
      const result = await payload.find({
        collection: 'offices',
        where: { organization: { equals: organizationId } },
        overrideAccess: true,
        depth: 0,
        limit: 1000,
      })
      return result.docs.map((doc) => String(doc.id))
    },
  }
}

function extractRequestedOrganizationId(req: PayloadRequest): string | null {
  if (!req.url) return null
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('asOrganization')
  } catch {
    return null
  }
}

// Punto único de composición: Capa 1 (identityProvider) + Capa 2 (resolveTenantContext),
// memoizado por request (nunca entre requests) para no repetir la query de membership en
// cada access check que Payload dispara dentro del mismo request.
export async function getTenantContext(req: PayloadRequest): Promise<TenantContext | null> {
  const cacheKey = 'tenantContext'
  if (req.context[cacheKey] !== undefined) {
    return req.context[cacheKey] as TenantContext | null
  }
  const identity = payloadNativeIdentityProvider.resolveIdentity(req)
  const requestedOrganizationId = extractRequestedOrganizationId(req)
  const deps = createPayloadTenantResolverDeps(req.payload)
  const ctx = await resolveTenantContext(identity, deps, requestedOrganizationId)
  req.context[cacheKey] = ctx
  return ctx
}
