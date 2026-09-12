import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'

// Solo-creación, igual que AuditLogs (doc 05 §5.2): una fotografía que se puede editar o borrar
// deja de servir como evidencia de auditoría. `create` es () => false a nivel de colección
// porque el único punto de escritura es domain/inventories/createInventorySnapshot.ts vía
// overrideAccess — invocado desde endpoints/inventorySnapshots.ts, nunca vía POST directo.
export const InventorySnapshots: CollectionConfig = {
  slug: 'inventory-snapshots',
  admin: {
    useAsTitle: 'taken_at',
  },
  access: {
    create: () => false,
    read: orgScopedAccess('inventory-snapshots', 'read'),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      required: true,
      index: true,
    },
    { name: 'taken_at', type: 'date', required: true },
    {
      name: 'generated_by',
      type: 'select',
      options: ['manual', 'scheduled', 'pre_audit'],
      required: true,
    },
    {
      name: 'triggered_by_user',
      type: 'relationship',
      relationTo: 'users',
    },
    {
      name: 'risk_score',
      type: 'group',
      fields: [
        { name: 'global', type: 'number' },
        { name: 'evaluated_percentage', type: 'number', required: true },
        { name: 'requires_attention', type: 'number', required: true },
        { name: 'excluded_assets', type: 'number' },
        { name: 'not_evaluable', type: 'number', required: true },
        { name: 'policy_snapshot', type: 'json' },
      ],
    },
    { name: 'assessment_results_snapshot', type: 'json', required: true },
    {
      // Copia por valor completa (depth:0 + clonada, ver createInventorySnapshot.ts) — nunca una
      // lista de referencias. Doc 05 §5.2: si fuera FKs, leer este snapshot mostraría el estado
      // *actual* de esos Assets, no el que tenían en `taken_at`.
      // Forma: { network: Asset[], non_network: NonNetworkAsset[] } — Other Assets es tan parte
      // del inventario como Network, un snapshot que solo copiara Assets documentaría la mitad
      // de lo que la UI ya muestra bajo "Inventory". El Risk Score se congela por separado desde
      // ComplianceResults vigentes; nunca se infiere del estado de este dump.
      name: 'assets_dump',
      type: 'json',
      required: true,
    },
  ],
}

export default InventorySnapshots
