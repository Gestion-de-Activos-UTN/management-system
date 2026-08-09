import type { CollectionConfig } from 'payload'

// TODO(rbac-feature): reemplazar por access real cuando exista TenantContext/RBAC (documentation/02-core-interfaces.md §4)
// Hasta entonces, nadie escribe/lee vía API — el alta pasa por scripts/seed-agent.ts con overrideAccess.
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: {
    useAsTitle: 'name',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
    },
  ],
}

export default Organizations
