import type { CollectionConfig } from 'payload'
import { globalReadAccess } from '../../access/rbac/orgScopedAccess'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura),
// no por falta de RBAC — el único punto de escritura es scripts/seed-navigation.ts.
export const Roles: CollectionConfig = {
  slug: 'roles',
  admin: {
    useAsTitle: 'slug',
  },
  access: {
    create: () => false,
    read: globalReadAccess('roles', 'read'), // catálogo global, sin scope de fila
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'rank',
      type: 'number',
      required: true,
      admin: {
        description: '1 = máxima autoridad',
      },
    },
    {
      name: 'scope',
      type: 'select',
      required: true,
      options: ['platform', 'organization', 'organization_office', 'office_user'],
    },
    {
      name: 'is_platform_role',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}

export default Roles
