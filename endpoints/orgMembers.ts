import type { Endpoint } from 'payload'
import { getTenantContext, type TenantContext } from '../access/tenant/resolveTenantContext'
import { relationId } from '../lib/relationId'
import { canDo, hasOrgWideScope, type RoleSlug } from '../access/rbac/permissions'
import { canChangeMemberStatus, canEditMemberOffices } from '../access/rbac/member-status'
import { adminErrorResponse, organizationAdminLock } from '../domain/organizations/admin-actions'
import { withTransaction } from '../domain/with-transaction'
import { createMember, updateMember } from '../domain/organizations/member-admin'
import { MemberCreateSchema, MemberUpdateSchema } from '../modules/users/schema'
import { ownedAssetsSummary } from '../domain/organizations/member-responsibilities'

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

// Memberships are read with depth 1; an unpopulated role (id only) yields no slug/rank, so every
// rank-based check fails closed instead of guessing.
function memberRole(membership: { role?: unknown }) {
  const role = membership.role as { slug?: RoleSlug; rank?: number } | string | null | undefined
  return typeof role === 'object' && role
    ? { slug: role.slug ?? null, rank: role.rank ?? null }
    : { slug: null, rank: null }
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

    // Administración → Usuarios necesita también a las personas desactivadas (para
    // reactivarlas); los selectores de persona siguen recibiendo sólo las activas.
    const includeInactive =
      new URL(req.url ?? 'http://localhost').searchParams.get('include_inactive') === '1' &&
      (canDo(ctx.role, 'organization-memberships', 'read', ctx.organizationId) ||
        canDo(ctx.role, 'organization-memberships', 'change_status', ctx.organizationId))
    const memberships = await req.payload.find({
      collection: 'organization-memberships',
      where: includeInactive
        ? { organization: { equals: ctx.organizationId } }
        : {
            organization: { equals: ctx.organizationId },
            is_active: { equals: true },
            status: { equals: 'active' },
          },
      overrideAccess: true,
      req,
      depth: 1,
      limit: 500,
    })

    const orgWide = hasOrgWideScope(ctx.role)
    const roleSlug = (m: (typeof memberships.docs)[number]) => memberRole(m).slug
    // Office-scoped roles only see people who share one of their offices, plus org-wide members
    // (who cover every office); the rest of the directory belongs to other offices.
    const visible = orgWide
      ? memberships.docs
      : memberships.docs.filter(
          m =>
            hasOrgWideScope(roleSlug(m)) ||
            (m.offices ?? []).some(office => ctx.officeIds.includes(relationId(office)))
        )

    const mayChangeStatus = (m: (typeof memberships.docs)[number]) =>
      canChangeMemberStatus(ctx, {
        organizationId: ctx.organizationId!,
        role: roleSlug(m),
        rank: memberRole(m).rank,
        officeIds: (m.offices ?? []).map(relationId),
      })
    // Inactive members outside delegated management must not become visible via this option.
    const docs = visible
      .filter(m => orgWide || m.is_active || mayChangeStatus(m))
      .map(m => {
        const user = m.user as unknown as { id: string; name: string; email: string }
        return {
          id: relationId(user),
          name: user.name,
          email: user.email,
          role: roleSlug(m),
          office_ids: (m.offices ?? []).map(relationId),
          status: m.status,
          is_active: Boolean(m.is_active),
          can_change_status: mayChangeStatus(m),
          can_edit_offices: canEditMemberOffices(ctx, {
            organizationId: ctx.organizationId!,
            role: roleSlug(m),
            rank: memberRole(m).rank,
            officeIds: (m.offices ?? []).map(relationId),
            isActive: Boolean(m.is_active),
          }),
        }
      })

    return json({ docs })
  },
}

export const createOrgMemberEndpoint: Endpoint = {
  path: '/v1/org-members',
  method: 'post',
  handler: async req => {
    try {
      const ctx = await getTenantContext(req)
      if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
      if (
        !ctx.organizationId ||
        !canDo(ctx.role, 'organization-memberships', 'create', ctx.organizationId)
      ) {
        return json({ error: 'forbidden' }, 403)
      }

      const parsed = MemberCreateSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_member', issues: parsed.error.issues }, 400)
      if (ctx.role === 'office_manager' && parsed.data.role !== 'org_viewer') {
        return json({ error: 'forbidden' }, 403)
      }

      const created = await withTransaction(
        req.payload,
        req,
        () => createMember(req, ctx as TenantContext & { organizationId: string }, parsed.data),
        { lockKey: organizationAdminLock(ctx.organizationId) }
      )
      return json(
        {
          id: String(created.user.id),
          name: created.user.name,
          email: created.user.email,
          role: parsed.data.role,
        },
        201
      )
    } catch (error) {
      return adminErrorResponse(error)
    }
  },
}

export const updateOrgMemberEndpoint: Endpoint = {
  path: '/v1/org-members/:id',
  method: 'patch',
  handler: async req => {
    try {
      const ctx = await getTenantContext(req)
      if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
      if (
        !ctx.organizationId ||
        !(
          canDo(ctx.role, 'organization-memberships', 'change_status', ctx.organizationId) ||
          canDo(ctx.role, 'organization-memberships', 'edit_offices', ctx.organizationId)
        )
      ) {
        return json({ error: 'forbidden' }, 403)
      }
      const parsed = MemberUpdateSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_member', issues: parsed.error.issues }, 400)
      const organizationId = ctx.organizationId
      await withTransaction(
        req.payload,
        req,
        () =>
          updateMember(
            req,
            ctx as TenantContext & { organizationId: string },
            String(req.routeParams?.id ?? ''),
            parsed.data
          ),
        { lockKey: organizationAdminLock(organizationId) }
      )
      return json({ ok: true })
    } catch (error) {
      return adminErrorResponse(error)
    }
  },
}

// Qué pasa al desactivar a una persona: sus activos a cargo (para elegir un reemplazo), las
// tareas en curso que vuelven a pendientes y las asignadas que van a pedir reasignación.
export const orgMemberDeactivationImpactEndpoint: Endpoint = {
  path: '/v1/org-members/:id/deactivation-impact',
  method: 'get',
  handler: async req => {
    const ctx = await getTenantContext(req)
    if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
    if (
      !ctx.organizationId ||
      !canDo(ctx.role, 'organization-memberships', 'change_status', ctx.organizationId)
    ) {
      return json({ error: 'forbidden' }, 403)
    }
    const organizationId = ctx.organizationId
    const userId = String(req.routeParams?.id ?? '')
    const membership = await req.payload.find({
      collection: 'organization-memberships',
      where: {
        and: [{ organization: { equals: organizationId } }, { user: { equals: userId } }],
      },
      overrideAccess: true,
      req,
      depth: 1,
      limit: 1,
    })
    if (!membership.docs[0]) return json({ error: 'member_not_found' }, 404)
    const target = membership.docs[0]
    const targetRole = memberRole(target)
    if (!targetRole.slug) return json({ error: 'member_not_found' }, 404)
    if (
      !canChangeMemberStatus(ctx, {
        organizationId,
        role: targetRole.slug,
        rank: targetRole.rank,
        officeIds: (target.offices ?? []).map(relationId),
      })
    )
      return json({ error: 'forbidden' }, 403)
    const openTasks = { organization: { equals: organizationId } }
    const [ownedAssets, inProgress, assigned] = await Promise.all([
      ownedAssetsSummary(req, organizationId, userId),
      req.payload.count({
        collection: 'tasks',
        where: {
          and: [
            openTasks,
            { status: { equals: 'in_progress' } },
            { 'claimed_by.relationTo': { equals: 'users' } },
            { 'claimed_by.value': { equals: userId } },
          ],
        },
        overrideAccess: true,
        req,
      }),
      req.payload.count({
        collection: 'tasks',
        where: {
          and: [
            openTasks,
            { status: { in: ['pending', 'in_progress'] } },
            { assigned_user: { equals: userId } },
          ],
        },
        overrideAccess: true,
        req,
      }),
    ])
    return json({
      owned_assets: ownedAssets,
      in_progress_tasks: inProgress.totalDocs,
      assigned_tasks: assigned.totalDocs,
    })
  },
}
