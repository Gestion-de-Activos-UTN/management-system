import { APIError, type PayloadRequest } from 'payload'

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

export async function assertOwnerBelongsToOrganization(
  req: PayloadRequest,
  ownerId: string,
  organizationId: string
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
    depth: 0,
    limit: 1,
  })
  if (result.docs.length === 0) {
    throw new OwnerOutOfScopeError(
      'El usuario asignado como owner no tiene una membership activa en esta organización'
    )
  }
}
