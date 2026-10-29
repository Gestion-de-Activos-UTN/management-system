import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo } from './permissions'

type TargetMember = { organizationId: string; role: string; officeIds: string[] }

function canManageMember(
  ctx: TenantContext,
  target: TargetMember,
  action: 'change_status' | 'edit_offices'
) {
  if (!ctx.isActive || !ctx.organizationId || ctx.organizationId !== target.organizationId)
    return false
  if (canDo(ctx.role, 'organization-memberships', 'update', ctx.organizationId)) return true
  return (
    canDo(ctx.role, 'organization-memberships', action, ctx.organizationId) &&
    target.role === 'org_viewer' &&
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
