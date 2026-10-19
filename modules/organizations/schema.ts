import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'

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
