import type { CollectionConfig } from 'payload'
import { rejectInactiveLogin } from '../../access/auth/rejectInactiveLogin'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// access:()=>false en las 4 acciones NO bloquea /api/admins/login ni /api/admins/me —
// el login de Payload es un endpoint aparte del control de acceso CRUD de la collection.
export const Admins: CollectionConfig = {
  slug: 'admins',
  auth: {
    // Ver Users/index.ts — mismos valores, mismo razonamiento (cookie compartida, refresh reactivo).
    tokenExpiration: 60 * 60,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
  },
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
      name: 'role',
      type: 'relationship',
      relationTo: 'roles',
      required: true,
      filterOptions: { is_platform_role: { equals: true } },
    },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'inactive'],
      defaultValue: 'active',
    },
  ],
}

export default Admins
