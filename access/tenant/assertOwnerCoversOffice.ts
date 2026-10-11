import { APIError, type PayloadRequest } from 'payload'
import { hasOrgWideScope, type RoleSlug } from '../rbac/permissions'
import { relationId } from '@/lib/relationId'

// Fila-nivel de RBAC (orgScopedAccess) valida qué filas puede tocar el actor, no qué *valor*
// puede escribir en una FK a otra colección — sin esto, un org_admin de la organización A podría
// asignar como owner a un usuario de la organización B con solo conocer su id. Mismo tipo de
// chequeo que assertOfficeInScope (collections/NonNetworkAssets/invariants.ts) para `office`,
// acá aplicado a `owner`, compartido entre Assets y NonNetworkAssets.
export class OwnerOutOfScopeError extends APIError {
  constructor(message: string) {
    super(message, 400, undefined, true)
  }
}

// El owner además tiene que alcanzar la oficina del activo: un rol de oficina solo ve sus
// oficinas (hasOrgWideScope), así que un owner de otra oficina no podría ver su propio activo.
export async function assertOwnerCoversOffice(
  req: PayloadRequest,
  ownerId: string,
  organizationId: string,
  officeId: string | null
): Promise<void> {
  const result = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      user: { equals: ownerId },
      organization: { equals: organizationId },
      is_active: { equals: true },
    },
    overrideAccess: true,
    req,
    depth: 1,
    limit: 1,
  })
  const membership = result.docs[0]
  if (!membership) {
    throw new OwnerOutOfScopeError(
      'El usuario asignado como owner no tiene una membership activa en esta organización'
    )
  }
  const role = membership.role as { slug?: RoleSlug } | string
  const orgWide = typeof role === 'object' && hasOrgWideScope(role.slug)
  const offices = (membership.offices ?? []).map(office => relationId(office))
  if (!orgWide && officeId && !offices.includes(officeId)) {
    throw new OwnerOutOfScopeError(
      'El usuario asignado como owner no pertenece a la oficina del activo'
    )
  }
}
