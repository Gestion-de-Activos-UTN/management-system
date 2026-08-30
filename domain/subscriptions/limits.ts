export const SUBSCRIPTION_LIMITS = {
  basic: {
    max_offices: 3,
    user_limits: {
      org_admin: 1,
      office_manager: 2,
      org_viewer: 4,
    },
  },
  premium: {
    max_offices: 10,
    user_limits: {
      org_admin: 3,
      office_manager: 10,
      org_viewer: 20,
    },
  },
} as const

export type SubscriptionLevel = keyof typeof SUBSCRIPTION_LIMITS
export type OrganizationRole = keyof (typeof SUBSCRIPTION_LIMITS)['basic']['user_limits']
export type SubscriptionLimits = (typeof SUBSCRIPTION_LIMITS)[SubscriptionLevel]

export function getSubscriptionLimits(level: SubscriptionLevel): SubscriptionLimits {
  return SUBSCRIPTION_LIMITS[level]
}
