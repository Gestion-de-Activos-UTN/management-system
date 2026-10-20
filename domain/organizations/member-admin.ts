import type { PayloadRequest } from 'payload'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { relationId } from '@/lib/relationId'
import { ROLE_LABELS } from '@/lib/role-labels'
import {
  AdminDomainError,
  assertOrganizationActive,
  subscriptionLimits,
} from '@/domain/organizations/admin-actions'
import { reassignOwnedAssets } from '@/domain/organizations/member-responsibilities'
import type { MemberCreate, MemberUpdate, OrganizationRoleSlug } from '@/modules/users/schema'

type Membership = {
  id: string
  email: string
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
  const user = doc.user as unknown as { id?: string; email?: string } | string
  let email = typeof user === 'object' && typeof user.email === 'string' ? user.email : ''
  if (!email) {
    const userIdFromRelation = relationId(user)
    if (userIdFromRelation) {
      const userDoc = await req.payload.findByID({
        collection: 'users',
        id: userIdFromRelation,
        overrideAccess: true,
        req,
        depth: 0,
      })
      email = userDoc.email
    }
  }
  return {
    id: String(doc.id),
    email,
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

export async function assertUserLimit(
  req: PayloadRequest,
  organizationId: string,
  role: { id: string; slug: OrganizationRoleSlug },
  excludeMembershipId?: string
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
        ...(excludeMembershipId ? [{ id: { not_equals: excludeMembershipId } }] : []),
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

/** Creates an active account and its single tenant membership inside the caller's transaction. */
export async function createMember(
  req: PayloadRequest,
  ctx: TenantContext & { organizationId: string },
  input: MemberCreate
) {
  const organizationId = ctx.organizationId
  await assertOrganizationActive(req, organizationId)

  const role = await roleBySlug(req, input.role)
  await assertUserLimit(req, organizationId, role)

  const existingUser = await req.payload.find({
    collection: 'users',
    where: { email: { equals: input.email } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  if (existingUser.docs.length) {
    throw new AdminDomainError('email_unavailable', 409, 'Ya existe una cuenta con ese correo.')
  }

  let offices: string[] = []
  if (input.role !== 'org_admin') {
    offices = await activeOfficeIds(req, organizationId, input.office_ids)
    if (offices.length !== input.office_ids.length) {
      throw new AdminDomainError(
        'invalid_offices',
        400,
        'Selecciona oficinas activas de la organización.'
      )
    }
    if (!offices.length) {
      throw new AdminDomainError('offices_required', 400, 'Asigna al menos una oficina activa.')
    }
    if (ctx.role === 'office_manager' && offices.some(id => !ctx.officeIds.includes(id))) {
      throw new AdminDomainError('office_out_of_scope', 403, 'Sólo puedes asignar tus oficinas.')
    }
  } else if (input.office_ids.length) {
    throw new AdminDomainError('invalid_offices', 400, 'Los OrgAdmins cubren todas las oficinas.')
  }

  // AUDIT: this action must emit an AuditLogs entry (user.create, chain_hash over {user, name, email}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  const user = await req.payload.create({
    collection: 'users',
    overrideAccess: true,
    req,
    data: { email: input.email, password: input.password, name: input.name, status: 'active' },
  })

  // AUDIT: this action must emit an AuditLogs entry (membership.create, chain_hash over {user, organization, role, offices}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {the new member and organization admins}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  const membership = await req.payload.create({
    collection: 'organization-memberships',
    overrideAccess: true,
    req,
    data: {
      user: user.id,
      organization: organizationId,
      offices,
      role: role.id,
      status: 'active',
      is_active: true,
    },
  })

  return { user, membership }
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
  if (input.is_active === false) {
    if (!input.confirm_email) {
      throw new AdminDomainError(
        'confirmation_required',
        400,
        'Escribe el correo de la persona para confirmar la desactivación.'
      )
    }
    if (input.confirm_email.trim().toLowerCase() !== membership.email.trim().toLowerCase()) {
      throw new AdminDomainError(
        'confirmation_mismatch',
        400,
        'El correo no coincide con el de la persona que vas a desactivar.'
      )
    }
  }
  if (userId === ctx.userId && input.is_active === false) {
    throw new AdminDomainError('cannot_deactivate_self', 409, 'No puedes desactivarte a ti mismo.')
  }
  const replacementId = input.replacement_owner_id
  if (replacementId) {
    const replacement =
      replacementId === userId ? null : await loadMembership(req, organizationId, replacementId)
    if (!replacement?.is_active) {
      throw new AdminDomainError(
        'invalid_replacement',
        400,
        'El nuevo responsable tiene que ser otra persona activa de la organización.'
      )
    }
  }

  const role =
    input.role && input.role !== membership.role.slug
      ? await roleBySlug(req, input.role)
      : membership.role
  const roleChanged = role.id !== membership.role.id
  const active = input.is_active ?? membership.is_active
  const reactivating = active && !membership.is_active

  if (reactivating) await assertOrganizationActive(req, organizationId)
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

  // Antes de desactivar: el reemplazo todavía valida contra la persona activa, y después el hook
  // releaseMemberResponsibilities ya no encuentra activos que dejar sin responsable.
  if (replacementId && membership.is_active && !active) {
    await reassignOwnedAssets(req, organizationId, userId, replacementId)
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
  // (doc 03, cascada de personas): reactivar es esta decisión explícita.
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
