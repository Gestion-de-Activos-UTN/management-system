import { canDo, hasOrgWideScope } from './permissions'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'

/** A Manager may consolidate its assigned offices, never an organization-wide evaluation. */
export function canReadAssignedOfficeRisk(
  ctx: Pick<TenantContext, 'role' | 'organizationId' | 'isActive'>
) {
  return Boolean(
    ctx.isActive &&
    ctx.organizationId &&
    !hasOrgWideScope(ctx.role) &&
    canDo(ctx.role, 'risk-evaluations', 'read_assigned', ctx.organizationId)
  )
}
