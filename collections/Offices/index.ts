import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
export const Offices: CollectionConfig = {
  slug: 'offices',
  admin: {
    useAsTitle: 'name',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('offices', 'read'),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'county_fips',
      type: 'text',
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
    },
  ],
}

export default Offices
