import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '../../access/rbac/orgScopedAccess'

// Escritura solo vía domain/inventories/ingestScanReport.ts con overrideAccess — mismo patrón que AuditLogs (SYSTEM_PROMPT.md §2).
export const ScanReports: CollectionConfig = {
  slug: 'scan-reports',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    create: () => false,
    // Sin campo `organization` propio (solo `office`) — scope por oficinas del actor, no por organización.
    read: orgScopedAccess('scan-reports', 'read', { kind: 'offices', field: 'office' }),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'id',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'report_id tal cual lo manda el escáner',
      },
    },
    {
      name: 'agent',
      type: 'relationship',
      relationTo: 'agents',
      required: true,
      index: true,
    },
    {
      // Derivado del agent autenticado — nunca del payload.
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'network',
      type: 'text',
    },
    {
      name: 'scan_start',
      type: 'date',
    },
    {
      name: 'scan_end',
      type: 'date',
    },
    {
      name: 'hosts_up',
      type: 'number',
    },
    {
      name: 'raw_payload',
      type: 'json',
    },
    {
      name: 'status',
      type: 'select',
      options: ['received', 'processed', 'failed'],
      defaultValue: 'received',
    },
    {
      name: 'processed_at',
      type: 'date',
    },
    {
      name: 'error',
      type: 'text',
    },
  ],
}

export default ScanReports
