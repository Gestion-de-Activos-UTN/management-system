import type { CollectionConfig } from 'payload'
import { PortalMessageEntityTypes, PORTAL_MESSAGE_SECTIONS } from '@/modules/portal-messages/schema'

const ORG_ROLE_OPTIONS = [
  { label: 'Administrador de organización', value: 'org_admin' },
  { label: 'Visualizador de organización', value: 'org_viewer' },
  { label: 'Responsable de oficina', value: 'office_manager' },
]

export const PortalMessages: CollectionConfig = {
  slug: 'portal-messages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'message_type', 'is_active', 'expires_at'],
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 100 },
    { name: 'description', type: 'textarea', required: true, maxLength: 500 },
    {
      name: 'message_type',
      type: 'select',
      required: true,
      options: [
        { label: 'Aviso', value: 'notice' },
        { label: 'Accionable', value: 'actionable' },
      ],
    },
    { name: 'template_key', type: 'text', admin: { readOnly: true } },
    { name: 'cta_label', type: 'text', maxLength: 30 },
    { name: 'scope', type: 'select', required: true, options: ['global', 'organizations'] },
    {
      name: 'target_organizations',
      type: 'relationship',
      relationTo: 'organizations',
      hasMany: true,
    },
    {
      name: 'target_kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Organización completa', value: 'all' },
        { label: 'Roles', value: 'role' },
        { label: 'Personas', value: 'user' },
      ],
    },
    { name: 'target_roles', type: 'select', hasMany: true, options: ORG_ROLE_OPTIONS },
    { name: 'target_users', type: 'relationship', relationTo: 'users', hasMany: true },
    {
      name: 'linked_section',
      type: 'select',
      options: PORTAL_MESSAGE_SECTIONS.map(value => ({ value, label: value })),
    },
    {
      name: 'linked_entity_type',
      type: 'select',
      options: PortalMessageEntityTypes.map(value => ({ value, label: value })),
    },
    {
      name: 'linked_entity',
      type: 'relationship',
      relationTo: [
        'tasks',
        'offices',
        'assets',
        'non-network-assets',
        'assessment-instances',
        'compliance-results',
        'inventory-snapshots',
        'scan-reports',
        'risk-evaluations',
        'agents',
      ],
    },
    { name: 'expires_at', type: 'date' },
    { name: 'is_active', type: 'checkbox', defaultValue: true },
    {
      name: 'delivery_version',
      type: 'number',
      required: true,
      defaultValue: 1,
      admin: { readOnly: true },
    },
    {
      name: 'created_by',
      type: 'relationship',
      relationTo: 'admins',
      admin: { readOnly: true },
      access: { update: () => false },
    },
  ],
  timestamps: true,
}

export default PortalMessages
