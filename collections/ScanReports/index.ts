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
      name: 'execution_status',
      type: 'select',
      options: ['completed', 'partial', 'failed'],
      required: true,
    },
    {
      name: 'report_coverage',
      type: 'json',
    },
    {
      name: 'scanner_interfaces',
      type: 'json',
    },
    {
      // Resuelto por el agente (tabla de ruteo/ARP), no un guess — todo asset de este
      // reporte está, por construcción del scan, detrás de este gateway (contracts/scan-report.schema.ts).
      name: 'gateway_ip',
      type: 'text',
    },
    {
      name: 'gateway_mac',
      type: 'text',
    },
    {
      name: 'raw_payload',
      type: 'json',
    },
    {
      name: 'raw_payload_expires_at',
      type: 'date',
      index: true,
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
