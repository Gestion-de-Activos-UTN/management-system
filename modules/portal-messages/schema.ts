import { z } from 'zod'
import { TASK_REFERENCE_COLLECTIONS } from '@/modules/tasks/schema'

export const PORTAL_MESSAGE_SECTIONS = [
  'dashboard',
  'risk-score',
  'security-review',
  'tasks',
  'inventory',
  'administration',
] as const

export const PORTAL_MESSAGE_ROLES = ['org_admin', 'org_viewer', 'office_manager'] as const

const organizationIds = z.array(z.uuid()).min(1, 'Selecciona al menos una organización.').max(500)

const OrgAudienceSchema = z.discriminatedUnion('target_kind', [
  z.object({
    scope: z.literal('organizations'),
    target_kind: z.literal('all'),
    organization_ids: organizationIds,
  }),
  z.object({
    scope: z.literal('organizations'),
    target_kind: z.literal('role'),
    organization_ids: organizationIds,
    role_slugs: z.array(z.enum(PORTAL_MESSAGE_ROLES)).min(1, 'Selecciona al menos un rol.').max(10),
  }),
  z.object({
    scope: z.literal('organizations'),
    target_kind: z.literal('user'),
    organization_ids: organizationIds,
    user_ids: z.array(z.uuid()).min(1, 'Selecciona al menos una persona.').max(500),
  }),
])

export const PortalMessageAudienceSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }),
  OrgAudienceSchema,
])

export const PortalMessageEntityTypes = ['tasks', ...TASK_REFERENCE_COLLECTIONS] as const
export const PortalMessageEntityTypeSchema = z.enum(PortalMessageEntityTypes)
export const PORTAL_MESSAGE_ENTITY_SECTION: Record<
  (typeof PortalMessageEntityTypes)[number],
  (typeof PORTAL_MESSAGE_SECTIONS)[number]
> = {
  tasks: 'tasks',
  offices: 'administration',
  assets: 'inventory',
  'non-network-assets': 'inventory',
  'assessment-instances': 'security-review',
  'compliance-results': 'security-review',
  'inventory-snapshots': 'inventory',
  'scan-reports': 'inventory',
  'risk-evaluations': 'risk-score',
  agents: 'administration',
}
export const PortalMessageSpecificEntitySchema = z.object({
  relationTo: PortalMessageEntityTypeSchema,
  value: z.string().min(1),
})

export const PortalMessageInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Escribe un título.').max(100),
    description: z.string().trim().min(1, 'Escribe una descripción.').max(500),
    message_type: z.enum(['notice', 'actionable']),
    template_key: z.string().min(1).optional(),
    cta_label: z.string().trim().max(30).optional().nullable(),
    audience: PortalMessageAudienceSchema,
    linked_section: z.enum(PORTAL_MESSAGE_SECTIONS).optional().nullable(),
    linked_entity_type: PortalMessageEntityTypeSchema.optional().nullable(),
    linked_entity: PortalMessageSpecificEntitySchema.optional().nullable(),
    expires_at: z.string().datetime({ offset: true }).optional().nullable(),
    is_active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if ((value.linked_entity || value.linked_entity_type) && !value.linked_section) {
      ctx.addIssue({
        code: 'custom',
        path: ['linked_section'],
        message: 'Selecciona la sección de la entidad enlazada.',
      })
    }
    if (value.linked_entity && value.linked_entity.relationTo !== value.linked_entity_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['linked_entity'],
        message: 'El tipo de entidad no coincide con la selección.',
      })
    }
    if (
      value.linked_entity_type &&
      PORTAL_MESSAGE_ENTITY_SECTION[value.linked_entity_type] !== value.linked_section
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['linked_entity_type'],
        message: 'La entidad específica no pertenece a la sección seleccionada.',
      })
    }
    if (value.message_type === 'notice' && value.cta_label) {
      ctx.addIssue({
        code: 'custom',
        path: ['cta_label'],
        message: 'Los avisos no tienen una acción principal personalizada.',
      })
    }
  })

export type PortalMessageInput = z.infer<typeof PortalMessageInputSchema>
export type PortalMessageAudience = z.infer<typeof PortalMessageAudienceSchema>
export type PortalMessageSpecificEntity = z.infer<typeof PortalMessageSpecificEntitySchema>
