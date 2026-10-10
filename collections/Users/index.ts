import type { CollectionConfig } from 'payload'
import { throttleLogin } from '../../access/auth/login-throttle'
import {
  guardSessionOperation,
  prepareAccountLogin,
  revokeInactiveSessions,
  lockLogout,
} from '../../access/auth/account-sessions'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// access:()=>false en las 4 acciones NO bloquea /api/users/login ni /api/users/me.
export const Users: CollectionConfig = {
  slug: 'users',
  endpoints: [{ path: '/first-register', method: 'post', handler: () => Response.json({ error: 'Accounts require provisioning' }, { status: 403 }) }],
  auth: {
    removeTokenFromResponses: true,
    // Corta, porque la sesión ahora vive en una cookie httpOnly con refresh reactivo
    // (lib/http-client.ts) — ya no depende de un TTL largo para no re-loguear seguido.
    tokenExpiration: 60 * 60,
    // Nombre de cookie compartido con Admins: viene de config.cookiePrefix global
    // ('payload' por default, ver payload.config.ts), no de una opción por-colección —
    // es lo que hace que loguear la cuenta B sobreescriba la cookie de la cuenta A sola.
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
    maxLoginAttempts: 0,
    useSessions: true,
  },
  admin: {
    useAsTitle: 'email',
  },
  access: {
    // No account-wide lockout or manual unlock; process-local throttling bounds attempts.
    unlock: () => false,
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeOperation: [throttleLogin, guardSessionOperation],
    beforeLogin: [prepareAccountLogin],
    beforeChange: [revokeInactiveSessions],
    afterLogout: [lockLogout],
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
