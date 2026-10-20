import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'
import { OfficeInputSchema } from '@/modules/offices/schema'
import { UserCredentialsSchema } from '@/modules/users/schema'
import { INDUSTRY_VALUES } from '@/domain/organizations/industry-options'

export const OrganizationCreateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la organización.')
      .max(200)
      .regex(...TEXT_RULES.label),
    industry: z.enum(INDUSTRY_VALUES),
    industry_details: z
      .string()
      .trim()
      .max(300)
      .regex(...TEXT_RULES.free)
      .optional(),
    plan: z.enum(['basic', 'premium']),
    first_office: OfficeInputSchema,
    first_admin: UserCredentialsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.industry !== 'other' && value.industry_details?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['industry_details'],
        message: 'La descripción sólo se usa cuando eliges “Otro”.',
      })
    }
  })

export type OrganizationCreateInput = z.infer<typeof OrganizationCreateSchema>

export const PlatformOrgAdminCreateSchema = UserCredentialsSchema
export type PlatformOrgAdminCreateInput = z.infer<typeof PlatformOrgAdminCreateSchema>

// Mismo schema en el modal de Organizaciones y en endpoints/platformOrganizations.ts.
// Desactivar exige escribir el nombre. Los nombres de organización no tienen regla de texto propia:
// sólo se descartan caracteres de control (TEXT_RULES.free) y el servidor compara tal cual (con trim).
export const OrganizationStatusSchema = z.discriminatedUnion('is_active', [
  z.object({ is_active: z.literal(true) }),
  z.object({
    is_active: z.literal(false),
    confirm_name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la organización para confirmar.')
      .max(200)
      .regex(...TEXT_RULES.free),
  }),
])

export type OrganizationStatusInput = z.infer<typeof OrganizationStatusSchema>
