import { z } from 'zod'

// Mismo schema en el modal de Organizaciones y en endpoints/platformOrganizations.ts.
// Desactivar exige escribir el nombre; los nombres de organización no tienen regla de texto,
// así que sólo se acota el largo y el servidor compara el texto tal cual (con trim).
export const OrganizationStatusSchema = z.discriminatedUnion('is_active', [
  z.object({ is_active: z.literal(true) }),
  z.object({
    is_active: z.literal(false),
    confirm_name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la organización para confirmar.')
      .max(200),
  }),
])

export type OrganizationStatusInput = z.infer<typeof OrganizationStatusSchema>
