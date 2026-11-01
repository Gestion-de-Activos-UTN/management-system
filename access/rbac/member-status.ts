import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope } from './permissions'

type TargetMember = {
  organizationId: string
  role: string | null
  rank: number | null | undefined
  officeIds: string[]
}

/** Rank 1 is the highest authority, so a larger rank means less authority. Unknown ranks deny. */
const hasLessAuthority = (target: number | null | undefined, actor: number | null | undefined) =>
  Number.isFinite(target) && Number.isFinite(actor) && target! > actor!

function canManageMember(
  ctx: TenantContext,
  target: TargetMember,
  action: 'change_status' | 'edit_offices'
) {
  if (!ctx.isActive || !ctx.organizationId || ctx.organizationId !== target.organizationId)
    return false
  if (!canDo(ctx.role, 'organization-memberships', action, ctx.organizationId)) return false
  // Organization-wide administration is not rank-limited: an OrgAdmin manages other OrgAdmins,
  // and the last-admin invariant is enforced by the domain.
  if (hasOrgWideScope(ctx.role)) return true
  return (
    hasLessAuthority(target.rank, ctx.roleRank) &&
    target.officeIds.length > 0 &&
    target.officeIds.every(id => ctx.officeIds.includes(id))
  )
}

export const canChangeMemberStatus = (ctx: TenantContext, target: TargetMember) =>
  canManageMember(ctx, target, 'change_status')

export const canEditMemberOffices = (
  ctx: TenantContext,
  target: TargetMember & { isActive: boolean }
) =>
  (target.isActive || canDo(ctx.role, 'organization-memberships', 'update', ctx.organizationId)) &&
  canManageMember(ctx, target, 'edit_offices')
