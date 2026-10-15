import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'

export const PlatformAdminProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(...TEXT_RULES.personName),
})

export type PlatformAdminProfileInput = z.infer<typeof PlatformAdminProfileSchema>
