import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'

const technicalFieldAccess = {
  // Bloque técnico: solo lo escribe el upsert de ingesta (domain/inventories/ingestScanReport.ts), nunca un humano.
  update: () => false,
}

// TODO(rbac-feature): bloque de negocio (alias..status) necesita access real de edición manual
// una vez exista TenantContext/RBAC — por ahora también () => false, nadie escribe vía API todavía.
// `owner` (FK→Users, documentation/05-inventory-architecture.md §5.1) se agrega cuando la collection Users exista —
// referenciar un slug de collection inexistente rompe payload.config.ts al build.
export const Assets: CollectionConfig = {
  slug: 'assets',
  admin: {
    useAsTitle: 'hostname',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('assets', 'read'),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'asset_id',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'agent',
      type: 'relationship',
      relationTo: 'agents',
      required: true,
      index: true,
      access: technicalFieldAccess,
    },
    {
      // Derivados del agent autenticado — nunca del payload de ingesta.
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      admin: { readOnly: true },
      access: technicalFieldAccess,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      admin: { readOnly: true },
      access: technicalFieldAccess,
    },
    { name: 'ip', type: 'text', access: technicalFieldAccess },
    { name: 'last_seen', type: 'date', access: technicalFieldAccess },
    { name: 'mac', type: 'text', access: technicalFieldAccess },
    { name: 'vendor', type: 'text', access: technicalFieldAccess },
    { name: 'hostname', type: 'text', access: technicalFieldAccess },
    {
      name: 'os',
      type: 'group',
      access: technicalFieldAccess,
      fields: [
        { name: 'name', type: 'text' },
        { name: 'accuracy', type: 'number' },
        { name: 'cpe', type: 'text', hasMany: true },
      ],
    },
    {
      name: 'services',
      type: 'array',
      access: technicalFieldAccess,
      fields: [
        { name: 'port', type: 'number' },
        { name: 'protocol', type: 'text' },
        { name: 'state', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'product', type: 'text' },
        { name: 'version', type: 'text' },
        { name: 'extra_info', type: 'text' },
        { name: 'cpe', type: 'text' },
      ],
    },
    // Bloque de negocio — nunca sobrescrito por el upsert de ingesta, solo en creación o edición manual.
    { name: 'alias', type: 'text' },
    { name: 'criticality', type: 'text' },
    { name: 'location', type: 'text' },
    {
      name: 'status',
      type: 'select',
      options: ['activo', 'retirado', 'offline'],
      defaultValue: 'activo',
    },
  ],
}

export default Assets
