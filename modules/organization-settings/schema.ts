import { z } from 'zod';

export const OrganizationSettingsFormSchema = z.object({
  offline_after_hours: z.number().int().min(1).nullable(),
  snapshot_before_each_scan: z.boolean(),
  snapshot_interval_days: z.number().int().min(1).nullable(),
});
