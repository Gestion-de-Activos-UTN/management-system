import type { CollectionConfig } from 'payload'
import { isDepartmentOf, provinceName } from '../../lib/argentina-geo'
import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'
import { syncOrgAdminMemberships } from './hooks/syncOrgAdminMemberships'

// TODO(rbac-feature): create/update/delete cerrados por alcance de esta fase (solo-lectura).
export const Offices: CollectionConfig = {
  slug: 'offices',
  admin: {
    useAsTitle: 'name',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('offices', 'read', { kind: 'org_offices', field: 'id' }),
    update: () => false,
    delete: () => false,
  },
  hooks: { afterChange: [syncOrgAdminMemberships] },
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
    // Ubicación en Argentina con códigos INDEC (lib/argentina-geo.ts). Reemplaza al county_fips
    // heredado, que era un código de condado de EE. UU. sin uso.
    {
      name: 'province_id',
      type: 'text',
      index: true,
      validate: (value: unknown) =>
        !value || provinceName(String(value)) ? true : 'Provincia inválida.',
    },
    {
      name: 'department_id',
      type: 'text',
      validate: (value: unknown, { siblingData }: { siblingData: { province_id?: string } }) =>
        !value ||
        (siblingData.province_id && isDepartmentOf(String(value), siblingData.province_id))
          ? true
          : 'El departamento no pertenece a la provincia.',
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
    },
  ],
}

export default Offices
