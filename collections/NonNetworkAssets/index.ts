import type { CollectionConfig } from 'payload'
import { orgScopedAccess, canDoAccess } from '@/access/rbac/orgScopedAccess'
import { resolveTenantAndReview } from './hooks/resolveTenant'
import { computeReviewStatus } from './invariants'

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
      maxLength: 120,
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
      options: ['low', 'medium', 'high', 'critical'],
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true, // RF-51a
    },
    { name: 'location', type: 'text', maxLength: 200 },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'retired'],
      defaultValue: 'active',
    },
    {
      // Override por-asset de la política de revisión de la organización
      // (OrganizationSettings.review_policy). Si viene vacío en create, el hook lo deriva de esa
      // política; si la organización no tiene política, queda null y lo carga el usuario.
      name: 'next_review_at',
      type: 'date',
    },
    {
      // Stampeado solo por el endpoint de confirmación de revisión (endpoints/nonNetworkAssetReview.ts),
      // nunca por una edición normal — distingue "alguien tocó el registro" de "alguien confirmó
      // que sigue vigente" (RF-53a).
      name: 'last_reviewed_at',
      type: 'date',
      admin: { readOnly: true },
      access: resolvedFieldAccess,
    },
    {
      // Virtual, no persistido — mismo patrón que Agents.status (afterRead, comparación de fecha).
      // Resuelve RF-53b sin ningún job: el "vencimiento" se computa al leer, no hace falta barrer
      // la tabla periódicamente para saber si un registro está vencido.
      name: 'review_status',
      type: 'text',
      virtual: true,
      admin: { readOnly: true },
      hooks: {
        afterRead: [
          ({ siblingData }) => computeReviewStatus(siblingData.next_review_at ?? null, new Date()),
        ],
      },
    },
    // NOTIFY: this event should trigger a Notification Bell entry for {owner} when a review comes due
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively
    // TODO: RF-53 (Task automática al owner al vencer la revisión) requiere el patrón Tasks/TaskTemplates
    // (RF-28), hoy sin implementar (colección stub vacía) — no se construye acá, es un módulo aparte.
    {
      // Campos propios de cada categoría (nº de licencia, vencimiento, proveedor cloud, retención
      // de backup) sin columnas por categoría.
      name: 'details',
      type: 'json',
      // `type: 'json'` no tiene `maxLength` (eso es solo de `text`) — un `validate` es la única
      // forma de acotarlo. Igual que alias/location: el PATCH/POST manual pega directo al REST
      // genérico de Payload, así que el Zod de modules/non-network-assets/schema.ts (que solo se
      // usa como tipo TS del lado del cliente) no alcanza como enforcement real.
      validate: (value: unknown) => {
        const size = JSON.stringify(value ?? {}).length;
        return size <= 5000 || `Details is too large (${size}/5000 characters)`;
      },
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
