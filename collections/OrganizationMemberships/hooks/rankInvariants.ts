import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, PayloadRequest } from 'payload'
import { assertNoRankEscalation, assertNotLastActiveOrgAdmin, isProtectedRole } from '../invariants'
import { relationId } from '@/lib/relationId'

async function getActorRoleRank(req: PayloadRequest): Promise<number | null> {
  if (!req.user) return null // bootstrap/overrideAccess sin sesión — sin actor, sin restricción
  if (req.user.collection === 'admins') return null // platform_admin: sin restricción de rank org-scoped

  const result = await req.payload.find({
    collection: 'organization-memberships',
    where: { user: { equals: req.user.id }, is_active: { equals: true } },
    overrideAccess: true,
    req,
    depth: 1,
    limit: 1,
  })
  const membership = result.docs[0]
  if (!membership) return null
  const role = membership.role as unknown as { rank: number }
  return role.rank
}

async function countOtherActiveOrgAdmins(
  req: PayloadRequest,
  organizationId: string,
  excludeMembershipId: string,
  orgAdminRoleId: string,
): Promise<number> {
  const result = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      organization: { equals: organizationId },
      role: { equals: orgAdminRoleId },
      is_active: { equals: true },
      id: { not_equals: excludeMembershipId },
    },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 0,
  })
  return result.totalDocs
}

// Bloqueo de rank-escalation cuando se asigna/cambia `role`.
export const blockRankEscalation: CollectionBeforeChangeHook = async ({ data, req }) => {
  if (!data?.role) return data
  // Ambas son lecturas independientes — se disparan en paralelo.
  const [targetRole, actorRank] = await Promise.all([
    req.payload.findByID({
      collection: 'roles',
      id: data.role as string,
      overrideAccess: true,
      req,
      depth: 0,
    }),
    getActorRoleRank(req),
  ])
  assertNoRankEscalation(actorRank, targetRole.rank)
  return data
}

// Invariante compartido: si la membership que se desactiva/borra es la de un rol protegido
// (org_admin), no puede ser la última activa de la organización. Usado por los hooks de
// update y delete — ambos solo difieren en cómo llegan al `originalDoc`/`membershipId`.
async function enforceLastActiveOrgAdminInvariant(
  req: PayloadRequest,
  organizationId: string,
  membershipId: string,
  roleId: string,
): Promise<void> {
  const role = await req.payload.findByID({
    collection: 'roles',
    id: roleId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (!isProtectedRole(role.slug)) return

  const countAfter = await countOtherActiveOrgAdmins(req, organizationId, membershipId, String(role.id))
  assertNotLastActiveOrgAdmin(countAfter)
}

// Invariante último org_admin activo — antes de persistir is_active:false.
export const blockLastActiveOrgAdminOnUpdate: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (operation !== 'update' || data?.is_active !== false || !originalDoc) return data
  if (originalDoc.is_active !== true) return data // ya estaba inactiva, no es una transición

  await enforceLastActiveOrgAdminInvariant(
    req,
    relationId(originalDoc.organization),
    String(originalDoc.id),
    relationId(originalDoc.role),
  )
  return data
}

// Mismo invariante para delete — beforeDelete solo trae `id`, hay que releer el doc.
export const blockLastActiveOrgAdminOnDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const doc = await req.payload.findByID({
    collection: 'organization-memberships',
    id,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (!doc.is_active) return

  await enforceLastActiveOrgAdminInvariant(req, relationId(doc.organization), String(doc.id), relationId(doc.role))
}
