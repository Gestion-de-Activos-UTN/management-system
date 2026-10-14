import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { relationId } from '@/lib/relationId'
import { ROLE_LABELS } from '@/lib/role-labels'
import { AdminDomainError, subscriptionLimits } from '@/domain/organizations/admin-actions'
import type { MemberUpdate, OrganizationRoleSlug } from '@/modules/users/schema'

type Membership = {
  id: string
  is_active: boolean
  role: { id: string; slug: OrganizationRoleSlug; rank: number }
  offices: string[]
}

async function loadMembership(req: PayloadRequest, organizationId: string, userId: string) {
  const found = await req.payload.find({
    collection: 'organization-memberships',
    where: { and: [{ organization: { equals: organizationId } }, { user: { equals: userId } }] },
    overrideAccess: true,
    req,
    depth: 1,
    sort: '-updatedAt',
    limit: 1,
  })
  const doc = found.docs[0]
  if (!doc)
    throw new AdminDomainError(
      'member_not_found',
      404,
      'La persona no pertenece a la organización.'
    )
  const role = doc.role as unknown as Membership['role']
  return {
    id: String(doc.id),
    is_active: Boolean(doc.is_active),
    role: { id: String(role.id), slug: role.slug, rank: role.rank },
    offices: (doc.offices ?? []).map(relationId),
  } satisfies Membership
}

async function roleBySlug(req: PayloadRequest, slug: OrganizationRoleSlug) {
  const found = await req.payload.find({
    collection: 'roles',
    where: { and: [{ slug: { equals: slug } }, { is_platform_role: { equals: false } }] },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  if (!found.docs[0]) throw new AdminDomainError('invalid_role', 400, 'Rol inválido.')
  return { id: String(found.docs[0].id), slug, rank: Number(found.docs[0].rank) }
}

async function assertUserLimit(
  req: PayloadRequest,
  organizationId: string,
  role: { id: string; slug: OrganizationRoleSlug },
  excludeMembershipId: string
) {
  const limit = (await subscriptionLimits(req, organizationId)).userLimit(role.slug)
  if (limit === null) return
  const active = await req.payload.count({
    collection: 'organization-memberships',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { role: { equals: role.id } },
        { is_active: { equals: true } },
        { id: { not_equals: excludeMembershipId } },
      ],
    },
    overrideAccess: true,
    req,
  })
  if (active.totalDocs >= limit) {
    throw new AdminDomainError(
      'user_limit_reached',
      409,
      `Tu plan permite hasta ${limit} ${limit === 1 ? 'persona' : 'personas'} con el rol ${ROLE_LABELS[role.slug]}.`
    )
  }
}

async function activeOfficeIds(req: PayloadRequest, organizationId: string, ids: string[]) {
  if (!ids.length) return []
  const found = await req.payload.find({
    collection: 'offices',
    where: {
      and: [
        { id: { in: ids } },
        { organization: { equals: organizationId } },
        { is_active: { equals: true } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs.map(office => String(office.id))
}

/**
 * Cambia el estado, el rol y/o las oficinas de una persona de la organización. Además de lo que
 * ya garantizan los hooks de OrganizationMemberships (nadie asigna un rol de más autoridad que el
 * propio; siempre queda un org_admin activo), acá se valida:
 * - nadie se desactiva a sí mismo;
 * - el tope de personas por rol del plan, al reactivar o al cambiar de rol;
 * - todo rol que no sea org_admin necesita al menos una oficina activa (el org_admin las cubre
 *   todas por el hook enforceOrgAdminOffices).
 */
export async function updateMember(
  req: PayloadRequest,
  ctx: TenantContext & { organizationId: string },
  userId: string,
  input: MemberUpdate
) {
  const organizationId = ctx.organizationId
  const membership = await loadMembership(req, organizationId, userId)
  if (userId === ctx.userId && input.is_active === false) {
    throw new AdminDomainError('cannot_deactivate_self', 409, 'No puedes desactivarte a ti mismo.')
  }

  const role =
    input.role && input.role !== membership.role.slug
      ? await roleBySlug(req, input.role)
      : membership.role
  const roleChanged = role.id !== membership.role.id
  const active = input.is_active ?? membership.is_active
  const reactivating = active && !membership.is_active

  if (active && (reactivating || roleChanged)) {
    await assertUserLimit(req, organizationId, role, membership.id)
  }

  let offices: string[] | undefined
  if (role.slug !== 'org_admin' && active) {
    offices = await activeOfficeIds(req, organizationId, input.office_ids ?? membership.offices)
    if (input.office_ids && offices.length !== new Set(input.office_ids).size) {
      throw new AdminDomainError(
        'invalid_offices',
        400,
        'Alguna oficina no existe o está inactiva.'
      )
    }
    if (!offices.length) {
      throw new AdminDomainError(
        'offices_required',
        400,
        'Asigna al menos una oficina activa a esta persona.'
      )
    }
  }

  // AUDIT: this action must emit an AuditLogs entry (membership.update — activate/deactivate/role/offices, chain_hash over {membership, role, offices, is_active}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {the affected user, org_admins of this organization}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'organization-memberships',
    id: membership.id,
    data: {
      is_active: active,
      ...(roleChanged ? { role: role.id } : {}),
      ...(offices ? { offices } : {}),
    },
    overrideAccess: true,
    // req lleva al actor: blockRankEscalation lo usa para impedir asignar más autoridad.
    req,
  })

  // La cascada de desactivación pasa Users.status a inactive pero, a propósito, no lo revierte
  // (doc 04 regla 5): reactivar es esta decisión explícita.
  if (reactivating) {
    await req.payload.update({
      collection: 'users',
      id: userId,
      data: { status: 'active' },
      overrideAccess: true,
      req,
    })
  }
}
