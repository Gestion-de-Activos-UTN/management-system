import { z } from 'zod'
import { MATURITY_BUDGET_VALUES, MATURITY_IT_OWNER_VALUES } from '@/domain/organizations/maturity'

export const OrganizationSettingsFormSchema = z.object({
  offline_after_hours: z.number().int().min(1).nullable(),
  snapshot_before_each_scan: z.boolean(),
  snapshot_interval_days: z.number().int().min(1).nullable(),
})

// Both answers are required together: a half-answered profile would yield no level anyway.
export const OrganizationMaturitySchema = z.object({
  maturity_it_owner: z.enum(MATURITY_IT_OWNER_VALUES),
  maturity_security_budget: z.enum(MATURITY_BUDGET_VALUES),
})

export type OrganizationMaturityValues = z.infer<typeof OrganizationMaturitySchema>
