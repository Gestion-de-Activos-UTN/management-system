import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'

/** Roles de una organización, de mayor a menor autoridad (rank 1, 5, 10). */
export const ORGANIZATION_ROLES = ['org_admin', 'office_manager', 'org_viewer'] as const
export type OrganizationRoleSlug = (typeof ORGANIZATION_ROLES)[number]

export const UserCredentialsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre completo.')
    .max(120)
    .regex(...TEXT_RULES.personName),
  email: z
    .string()
    .trim()
    .email('Escribe un correo válido.')
    .max(254)
    .transform(value => value.toLowerCase()),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128),
})

export const MemberCreateSchema = UserCredentialsSchema.extend({
  role: z.enum(ORGANIZATION_ROLES),
  office_ids: z.array(z.uuid()).max(500).default([]),
})

export type MemberCreate = z.infer<typeof MemberCreateSchema>
export type UserCredentials = z.infer<typeof UserCredentialsSchema>

// Mismo schema en el modal de Administración → Usuarios y en endpoints/orgMembers.ts.
export const MemberUpdateSchema = z
  .object({
    is_active: z.boolean().optional(),
    role: z.enum(ORGANIZATION_ROLES).optional(),
    office_ids: z.array(z.uuid()).max(500).optional(),
    // Al desactivar: quién pasa a ser responsable de sus activos. Sin él, quedan sin responsable.
    replacement_owner_id: z.uuid().optional(),
    confirm_email: z
      .string()
      .trim()
      .email('Escribe un correo válido para confirmar.')
      .max(254)
      .transform(value => value.toLowerCase())
      .optional(),
  })
  .refine(value => Object.values(value).some(field => field !== undefined), {
    message: 'No hay cambios para guardar.',
  })
  .refine(value => !value.replacement_owner_id || value.is_active === false, {
    message: 'El reemplazo de responsable sólo aplica al desactivar.',
    path: ['replacement_owner_id'],
  })
  .refine(value => value.is_active !== false || value.confirm_email !== undefined, {
    message: 'Escribe el correo de la persona para confirmar la desactivación.',
    path: ['confirm_email'],
  })
  .refine(value => value.confirm_email === undefined || value.is_active === false, {
    message: 'El correo de confirmación sólo aplica al desactivar.',
    path: ['confirm_email'],
  })

export const ProfileUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe tu nombre.')
    .max(120)
    .regex(...TEXT_RULES.personName),
})

export type MemberUpdate = z.infer<typeof MemberUpdateSchema>
