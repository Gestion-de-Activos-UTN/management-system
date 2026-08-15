import type { CollectionConfig } from 'payload'
import { rejectInactiveLogin } from '../../access/auth/rejectInactiveLogin'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// access:()=>false en las 4 acciones NO bloquea /api/users/login ni /api/users/me.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: { tokenExpiration: 60 * 60 * 24 * 7 },
  admin: {
    useAsTitle: 'email',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeLogin: [rejectInactiveLogin],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'inactive'],
      defaultValue: 'active',
    },
    {
      // Solo lo escribe el hook afterChange de OrganizationMemberships (create) — nunca a mano.
      name: 'organization_membership',
      type: 'relationship',
      relationTo: 'organization-memberships',
      admin: { readOnly: true },
    },
  ],
}

export default Users
