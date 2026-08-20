import type { CollectionConfig } from 'payload'
import { orgScopedAccess, canDoAccess } from '@/access/rbac/orgScopedAccess'
import { resolveTenantAndReview } from './hooks/resolveTenant'

const resolvedFieldAccess = {
  create: () => false,
  update: () => false,
}

export const NonNetworkAssets: CollectionConfig = {
  slug: 'non-network-assets',
  admin: {
    useAsTitle: 'alias',
  },
  access: {
    // `create` no admite filtro de fila (todavía no hay fila): el binding al tenant lo hace el
    // beforeChange, que valida `office` contra ctx.officeIds y deriva `organization` de ahí.
    create: canDoAccess('non-network-assets', 'create'),
    read: orgScopedAccess('non-network-assets', 'read'),
    update: orgScopedAccess('non-network-assets', 'update'),
    delete: orgScopedAccess('non-network-assets', 'delete'),
  },
  hooks: {
    beforeChange: [resolveTenantAndReview],
  },
  fields: [
    {
      name: 'alias',
      type: 'text',
      required: true,
    },
    {
      // Enum fijo en código (no catálogo en DB): la matriz RBAC ya es estática por la misma razón
      // (documentation/01-erd-core.md nota 9) y esto da un union literal en payload-types.ts,
      // con el que el risk score puede hacer switch exhaustivo. Cambiar la lista = deploy.
      name: 'asset_category',
      type: 'select',
      required: true,
      options: [
        { label: 'Antivirus / EDR', value: 'antivirus_edr' },
        { label: 'Licencia de software', value: 'software_license' },
        { label: 'Activo en la nube', value: 'cloud_asset' },
        { label: 'Backup', value: 'backup' },
        { label: 'Otro', value: 'other' },
      ],
    },
    {
      name: 'criticality',
      type: 'select',
      required: true,
      options: ['baja', 'media', 'alta', 'critica'],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true, // RF-51a
    },
    { name: 'location', type: 'text' },
    {
      name: 'status',
      type: 'select',
      options: ['activo', 'retirado'],
      defaultValue: 'activo',
    },
    {
      // Override por-asset de la política de revisión de la organización
      // (OrganizationSettings.review_policy). Si viene vacío en create, el hook lo deriva de esa
      // política; si la organización no tiene política, queda null y lo carga el usuario.
      // TODO: diseñar el workflow de revision con actualizacion de proxima fecha de review automatica.
      name: 'next_review_at',
      type: 'date',
    },
    {
      // Campos propios de cada categoría (nº de licencia, vencimiento, proveedor cloud, retención
      // de backup) sin columnas por categoría.
      name: 'details',
      type: 'json',
    },
    {
      // Relación opcional N:M pensada para risk score (ej. licencia de Windows Server ↔ el servidor
      // que la usa) — no todo NonNetworkAsset tiene un Asset asociado (ej. backup de un SaaS que no
      // vive en la LAN del cliente), y una licencia por volumen puede cubrir varios.
      // Placeholder — sin lógica de correlación todavía.
      name: 'related_assets',
      type: 'relationship',
      relationTo: 'assets',
      hasMany: true,
      required: false,
    },
    {
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      required: true,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      admin: { readOnly: true },
      access: resolvedFieldAccess,
    },
    {
      name: 'last_updated_at',
      type: 'date',
      admin: { readOnly: true },
      access: resolvedFieldAccess,
    },
  ],
}

export default NonNetworkAssets
