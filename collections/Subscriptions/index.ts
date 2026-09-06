import type { CollectionConfig } from 'payload'

import { SUBSCRIPTION_LIMITS } from '../../domain/subscriptions/limits'

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
      options: Object.keys(SUBSCRIPTION_LIMITS),
    },
    {
      name: 'user_limits',
      type: 'json',
      required: true,
      admin: {
        description: 'Topes por rol: org_admin, office_manager y org_viewer.',
      },
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
