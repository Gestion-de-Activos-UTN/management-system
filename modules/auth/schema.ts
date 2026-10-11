import { z } from 'zod'

export const PlatformAdminProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
})

export type PlatformAdminProfileInput = z.infer<typeof PlatformAdminProfileSchema>
