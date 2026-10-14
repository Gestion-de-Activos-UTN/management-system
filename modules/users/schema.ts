import { z } from 'zod'

/** Roles de una organización, de mayor a menor autoridad (rank 1, 5, 10). */
export const ORGANIZATION_ROLES = ['org_admin', 'office_manager', 'org_viewer'] as const
export type OrganizationRoleSlug = (typeof ORGANIZATION_ROLES)[number]

// Mismo schema en el modal de Administración → Usuarios y en endpoints/orgMembers.ts.
export const MemberUpdateSchema = z
  .object({
    is_active: z.boolean().optional(),
    role: z.enum(ORGANIZATION_ROLES).optional(),
    office_ids: z.array(z.uuid()).max(500).optional(),
  })
  .refine(value => Object.values(value).some(field => field !== undefined), {
    message: 'No hay cambios para guardar.',
  })

export const ProfileUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Escribe tu nombre.').max(120),
})

export type MemberUpdate = z.infer<typeof MemberUpdateSchema>
