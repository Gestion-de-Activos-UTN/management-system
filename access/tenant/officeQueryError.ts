import { hasOrgWideScope } from '../rbac/permissions'
import type { TenantContext } from './resolveTenantContext'

/**
 * Validates an `office_id` query param against the caller's scope. Without one, the request asks
 * for the organization-wide view, which only org-wide roles may read; office-scoped roles must
 * name one of their offices (there is no multi-office evaluation to fall back to).
 */
export function officeQueryError(
  ctx: Pick<TenantContext, 'role' | 'officeIds'>,
  officeId: string | null | undefined
): 'office_forbidden' | 'office_required' | null {
  if (officeId) return ctx.officeIds.includes(officeId) ? null : 'office_forbidden'
  return hasOrgWideScope(ctx.role) ? null : 'office_required'
}
