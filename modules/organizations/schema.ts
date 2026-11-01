import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'
import { OfficeInputSchema } from '@/modules/offices/schema'
import { UserCredentialsSchema } from '@/modules/users/schema'
import { INDUSTRY_VALUES } from '@/domain/organizations/industry-options'

const OrganizationDetailsFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre de la organización.')
    .max(200)
    .regex(...TEXT_RULES.label),
  industry: z.enum(INDUSTRY_VALUES, { error: 'Selecciona un rubro.' }),
  industry_details: z
    .string()
    .trim()
    .max(300)
    .regex(...TEXT_RULES.free)
    .optional(),
})

function validateIndustryDetails(
  value: z.infer<typeof OrganizationDetailsFieldsSchema>,
  ctx: z.RefinementCtx
) {
  if (value.industry !== 'other' && value.industry_details?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['industry_details'],
      message: 'La descripción sólo se usa cuando eliges “Otro”.',
    })
  }
}

export const OrganizationDetailsSchema =
  OrganizationDetailsFieldsSchema.strict().superRefine(validateIndustryDetails)
export type OrganizationDetailsInput = z.infer<typeof OrganizationDetailsSchema>

export const OrganizationCreateSchema = OrganizationDetailsFieldsSchema.extend({
  plan: z.enum(['basic', 'premium']),
  first_office: OfficeInputSchema,
  first_admin: UserCredentialsSchema,
}).superRefine(validateIndustryDetails)

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
