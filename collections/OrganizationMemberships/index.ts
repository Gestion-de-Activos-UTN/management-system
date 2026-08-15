import type { CollectionConfig } from 'payload'
import { enforceImmutableOrgAndUser } from './hooks/immutability'
import {
  blockRankEscalation,
  blockLastActiveOrgAdminOnUpdate,
  blockLastActiveOrgAdminOnDelete,
} from './hooks/rankInvariants'
import { linkMembershipToUser, cascadeDeactivationToUser } from './hooks/userLifecycleCascade'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
// Ni siquiera `read` esta fase — no hay UI de "ver mi membership" todavía; el TenantContext
// se expone por access/tenant/resolveTenantContext.ts, no leyendo la collection cruda.
export const OrganizationMemberships: CollectionConfig = {
  slug: 'organization-memberships',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      unique: true, // resuelve "una membership por usuario" a nivel de constraint, sin hook extra
      index: true,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'offices',
      type: 'relationship',
      relationTo: 'offices',
      hasMany: true,
    },
    {
      name: 'role',
      type: 'relationship',
      relationTo: 'roles',
      required: true,
      filterOptions: { is_platform_role: { equals: false } },
    },
    {
      name: 'status',
      type: 'select',
      options: ['onboarding', 'active'],
      defaultValue: 'onboarding',
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
    },
  ],
  hooks: {
    beforeValidate: [enforceImmutableOrgAndUser],
    beforeChange: [blockRankEscalation, blockLastActiveOrgAdminOnUpdate],
    beforeDelete: [blockLastActiveOrgAdminOnDelete],
    afterChange: [linkMembershipToUser, cascadeDeactivationToUser],
  },
}

export default OrganizationMemberships
