import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'

/** Business inventory exceptions, separate from the future audit/notification modules. */
export const InventoryIncidents: CollectionConfig = {
  slug: 'inventory-incidents',
  admin: { useAsTitle: 'reason' },
  access: {
    create: () => false,
    update: () => false,
    delete: () => false,
    read: orgScopedAccess('assets', 'read', { kind: 'org_offices', field: 'office' }),
  },
  fields: [
    { name: 'incident_key', type: 'text', unique: true, required: true },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    { name: 'office', type: 'relationship', relationTo: 'offices', required: true, index: true },
    { name: 'proposed_office', type: 'relationship', relationTo: 'offices' },
    { name: 'asset', type: 'relationship', relationTo: 'assets', index: true },
    { name: 'agent', type: 'relationship', relationTo: 'agents' },
    { name: 'kind', type: 'select', options: ['location', 'identity'], required: true },
    {
      name: 'status',
      type: 'select',
      options: ['pending', 'moved', 'kept', 'reviewed'],
      defaultValue: 'pending',
      required: true,
      index: true,
    },
    { name: 'reason', type: 'text', required: true, maxLength: 500 },
    { name: 'ip', type: 'text', maxLength: 45 },
    { name: 'report_id', type: 'text', maxLength: 120 },
    { name: 'observed_at', type: 'date', required: true },
    { name: 'resolved_at', type: 'date' },
    { name: 'resolved_by', type: 'relationship', relationTo: ['users', 'admins'] },
  ],
}
