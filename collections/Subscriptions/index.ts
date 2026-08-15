import type { CollectionConfig } from 'payload'

// Sin lectura ni escritura externa esta fase — solo lo escribe
// domain/organizations/createOrgWithAdmin.ts vía overrideAccess.
export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    useAsTitle: 'level',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'level',
      type: 'select',
      required: true,
      options: ['basic', 'premium', 'custom'],
    },
    {
      name: 'max_users',
      type: 'number',
    },
    {
      name: 'max_offices',
      type: 'number',
    },
    {
      name: 'features',
      type: 'json',
      admin: {
        description: 'Mapa plano feature_key -> boolean, ver domain/subscriptions/features.ts',
      },
    },
  ],
}

export default Subscriptions
