import type { CollectionConfig } from 'payload'

import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// El alta real de una Organization pasa por domain/organizations/createOrgWithAdmin.ts
// (o scripts/seed-agent.ts para el canal de Agents) con overrideAccess, nunca por POST directo.
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: {
    useAsTitle: 'name',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('organizations', 'read', { kind: 'self' }),
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
    {
      // 1:1, bloqueado a escritura directa — solo lo setea createOrgWithAdmin (overrideAccess).
      name: 'settings',
      type: 'relationship',
      relationTo: 'organization-settings',
      access: { update: () => false },
    },
    {
      // 1:1, bloqueado a escritura directa — solo lo setea createOrgWithAdmin (overrideAccess).
      name: 'subscription',
      type: 'relationship',
      relationTo: 'subscriptions',
      access: { update: () => false },
    },
  ],
}

export default Organizations
