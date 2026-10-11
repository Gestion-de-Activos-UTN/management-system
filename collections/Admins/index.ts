import type { CollectionConfig } from 'payload'
import {
  guardSessionOperation,
  prepareAccountLogin,
  revokeInactiveSessions,
  lockLogout,
} from '../../access/auth/account-sessions'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// access:()=>false en las 4 acciones NO bloquea /api/admins/login ni /api/admins/me —
// el login de Payload es un endpoint aparte del control de acceso CRUD de la collection.
export const Admins: CollectionConfig = {
  slug: 'admins',
  auth: {
    removeTokenFromResponses: true,
    // Ver Users/index.ts — mismos valores, mismo razonamiento (cookie compartida, refresh reactivo).
    tokenExpiration: 60 * 60,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
    // Payload's native lockout: no proxy/infra needed. The lock expires on its own after lockTime.
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    useSessions: true,
  },
  admin: {
    useAsTitle: 'email',
  },
  endpoints: [{ path: '/first-register', method: 'post', handler: () => Response.json({ error: 'Bootstrap is available only through the seed CLI' }, { status: 403 }) }],
  access: {
    // No manual unlock: a locked account waits for lockTime instead.
    unlock: () => false,
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeOperation: [guardSessionOperation],
    beforeLogin: [prepareAccountLogin],
    beforeChange: [revokeInactiveSessions],
    afterLogout: [lockLogout],
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
