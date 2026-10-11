import { ORGANIZATION_ROLES, type OrganizationRoleSlug } from '@/modules/users/schema'

/** Topes del plan de una organización; null = sin tope cargado para ese ítem. */
export type PlanLimits = {
  max_offices: number | null
  user_limits: Record<OrganizationRoleSlug, number | null>
}

// Única lectura de los topes del documento de Subscriptions: la usan los endpoints que los
// hacen cumplir (domain/organizations/admin-actions.ts) y la sesión que los muestra en la UI.
export function planLimits(
  subscription?: { max_offices?: unknown; user_limits?: unknown } | null
): PlanLimits {
  const raw =
    subscription?.user_limits && typeof subscription.user_limits === 'object'
      ? (subscription.user_limits as Record<string, unknown>)
      : {}
  const limit = (value: unknown) => (typeof value === 'number' ? value : null)
  return {
    max_offices: limit(subscription?.max_offices),
    user_limits: Object.fromEntries(
      ORGANIZATION_ROLES.map(role => [role, limit(raw[role])])
    ) as PlanLimits['user_limits'],
  }
}
