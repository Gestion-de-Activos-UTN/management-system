import type { CollectionConfig } from 'payload'
import { appendOnlyGuard } from '@/domain/audit/collection-guard'

// Eventos del AuditLog (documentation/planes/audit-log/02-modelo-y-captura.md §2). Cada campo es
// uno del sobre v1 (domain/audit/envelope.ts) con el mismo nombre, más chain_hash: el
// verificador rearma el sobre desde la fila. Reglas:
// - Sin relaciones: las referencias históricas son ids de texto (un borrado de entidad no borra
//   su evidencia). Por eso también son texto los enums: los valida el sobre, y agregar un valor
//   no cambia el schema.
// - `id` propio de texto (UUID que genera el builder antes de firmar): el HMAC y el AAD del
//   contexto de red lo necesitan. Payload descarta el id del create salvo con allowIDOnCreate,
//   que es global del adaptador (decisión de Tani, 23/11).
// - `office_ids`: text hasMany (tabla audit_logs_texts, con orden), filtrable con `where` (F3).
// - Sin createdAt/updatedAt de Payload: la fecha es created_at, la del sobre.
// - Fuera de los índices: nombres, emails, IPs, motivos y valores históricos (están en payload).
// - Acceso directo denegado; create solo desde el cierre transaccional; update/delete nunca.

const text = (name: string, options: { required?: boolean } = {}) =>
  ({ name, type: 'text', required: options.required ?? false }) as const

export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  timestamps: false,
  lockDocuments: false,
  disableDuplicate: true,
  admin: { hidden: true },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeOperation: [appendOnlyGuard('AuditLogs')],
  },
  indexes: [
    { fields: ['chain_id', 'sequence'], unique: true },
    { fields: ['organization_id', 'created_at'] },
    { fields: ['action_code', 'created_at'] },
    { fields: ['actor_id', 'created_at'] },
    { fields: ['entity_type', 'entity_id'] },
  ],
  fields: [
    { name: 'id', type: 'text', required: true, unique: true },
    { name: 'schema_version', type: 'number', required: true },
    text('scope_kind', { required: true }),
    text('chain_id', { required: true }),
    text('organization_id'),
    { name: 'office_ids', type: 'text', hasMany: true },
    { name: 'sequence', type: 'number', required: true },
    { name: 'created_at', type: 'date', required: true },
    { name: 'occurred_at', type: 'date' },
    text('category_code', { required: true }),
    text('action_code', { required: true }),
    text('section_code', { required: true }),
    text('entity_type', { required: true }),
    text('entity_id', { required: true }),
    text('actor_type', { required: true }),
    text('actor_id'),
    text('actor_collection'),
    text('actor_role'),
    text('initiated_by_type'),
    text('initiated_by_id'),
    { name: 'operation_id', type: 'text', required: true, index: true },
    text('parent_event_id'),
    { name: 'visit_id', type: 'text', index: true },
    text('origin', { required: true }),
    text('outcome', { required: true }),
    { name: 'payload', type: 'json', required: true },
    text('network_digest'),
    { name: 'network_expires_at', type: 'date' },
    text('hmac_key_id', { required: true }),
    text('previous_hash'),
    text('chain_hash', { required: true }),
  ],
}
