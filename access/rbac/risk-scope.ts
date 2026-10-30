import { canDo } from './permissions'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'

/** A Manager may consolidate its assigned offices, never an organization-wide evaluation. */
export function canReadAssignedOfficeRisk(
  ctx: Pick<TenantContext, 'role' | 'organizationId' | 'isActive'>
) {
  return Boolean(
    ctx.isActive &&
    ctx.organizationId &&
    ctx.role === 'office_manager' &&
    canDo(ctx.role, 'risk-evaluations', 'read', ctx.organizationId)
  )
}
