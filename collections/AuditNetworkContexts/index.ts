import type { CollectionConfig } from 'payload'
import { appendOnlyGuard } from '@/domain/audit/collection-guard'

// Contexto de red de una solicitud, cifrado con AES-256-GCM (documentation/planes/audit-log/
// 02-modelo-y-captura.md §2 y 03 §3): una fila por evento, fuera de la cadena. Los campos son
// los de EncryptedNetworkContext (domain/audit/network-crypto.ts), en base64, más el evento y la
// cadena, que también van en el AAD: el ciphertext no se puede mover a otro evento.
// El evento firma el contexto en claro con network_digest, así que al purgar esta fila la
// cadena sigue verificando. La crea el mismo cierre transaccional que el evento; solo la borra
// la purga de retención (03 §8, fase posterior: hoy todo delete se rechaza).

export const AuditNetworkContexts: CollectionConfig = {
  slug: 'audit-network-contexts',
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
    beforeOperation: [appendOnlyGuard('AuditNetworkContexts')],
  },
  fields: [
    { name: 'event_id', type: 'text', required: true, unique: true },
    { name: 'chain_id', type: 'text', required: true },
    { name: 'cipher_version', type: 'number', required: true },
    { name: 'key_id', type: 'text', required: true },
    { name: 'nonce', type: 'text', required: true },
    { name: 'tag', type: 'text', required: true },
    { name: 'ciphertext', type: 'text', required: true },
  ],
}
