import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'
import { transactionDb, transactionLock } from '../transaction-locks'
import type { PendingAuditEvent } from './builder'
import type { AuditKeys } from './config'
import { parseAuditEnvelope } from './envelope'
import { computeChainHash, computeNetworkDigest } from './hmac'
import { internalAuditWriteContext, revokeInternalAuditWrite } from './internal-write'
import { encryptNetworkContext } from './network-crypto'
import { getAuditKeys } from './runtime-keys'

// Escritura en la cadena (documentation/planes/audit-log/03-seguridad-y-claves.md §3 y §4). La
// llama solo commitTransactionWithAudit (domain/with-transaction.ts), como último paso de la
// transacción, con los eventos del buffer:
// 1. Valida los llaveros otra vez (segunda línea de defensa: la primera es al iniciar Payload).
// 2. Por cada cadena, en orden de chain_id (orden de locks determinista, 03 §4.6): toma el lock
//    `audit:<chain_id>`, lee la cabeza (último evento: sequence y chain_hash) y agrega sus eventos
//    en el orden en que se acumularon. Sin tabla de cabezas: el último evento es la cabeza.
// 3. Por evento: fija sequence y created_at antes de firmar, cifra el contexto de red y calcula su
//    digest, valida el sobre completo, calcula chain_hash e inserta el evento y su contexto.
// Todas las consultas van de a una, con await, dentro de la transacción: nunca en paralelo sobre
// el mismo cliente (Tani, 23/11; pg@9 deja de admitirlo). La restricción única (chain_id,
// sequence) es la última defensa: en REPEATABLE READ una cabeza vieja termina en 23505 y
// withTransaction reintenta el comando entero.

export const AUDIT_NETWORK_RETENTION_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

/** Clave del advisory lock de una cadena (la toma el cierre; los comandos REPEATABLE READ, al inicio). */
export const auditChainLockKey = (chainId: string) => `audit:${chainId}`

/** Lock de la cadena de una organización, para `lockKeys` de withTransaction (03 §4.4). */
export const auditOrganizationLockKey = (organizationId: string) =>
  auditChainLockKey(`org:${organizationId}`)

export class AuditChainError extends Error {
  constructor(message: string) {
    super(`AuditLog: ${message}`)
    this.name = 'AuditChainError'
  }
}

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/

/**
 * Entero exacto leído de la base. node-postgres devuelve `numeric` como texto, y "2" no firma
 * igual que 2: se convierte explícitamente y se rechaza todo lo que no sea un entero no negativo
 * exacto y seguro ("2.0", "1e3", " 2", "", 2.5, 2^53 + 1...). Lo usa también el verificador.
 */
export function parseAuditInteger(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return value
  } else if (typeof value === 'string' && DECIMAL_INTEGER.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && String(parsed) === value) return parsed
  }
  throw new AuditChainError(`${field} no es un entero exacto.`)
}

interface ChainHead {
  sequence: number
  chainHash: string
}

/** Escribe los eventos de una transacción en sus cadenas. Sin eventos, no hace nada. */
export async function writeAuditEvents(
  req: PayloadRequest,
  events: readonly PendingAuditEvent[]
): Promise<void> {
  if (events.length === 0) return
  const keys = getAuditKeys()

  const byChain = new Map<string, PendingAuditEvent[]>()
  for (const event of events) {
    const chain = byChain.get(event.draft.chain_id) ?? []
    chain.push(event)
    byChain.set(event.draft.chain_id, chain)
  }

  for (const chainId of [...byChain.keys()].sort()) {
    await transactionLock(req, auditChainLockKey(chainId))
    let head = await readChainHead(req, chainId)
    for (const event of byChain.get(chainId)!) head = await appendEvent(req, event, head, keys)
  }
}

async function readChainHead(req: PayloadRequest, chainId: string): Promise<ChainHead | null> {
  const db = await transactionDb(req)
  const result = await db.execute(
    sql`SELECT sequence, chain_hash FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence DESC LIMIT 1`
  )
  const row = result.rows[0] as { sequence?: unknown; chain_hash?: unknown } | undefined
  if (!row) return null
  if (typeof row.chain_hash !== 'string')
    throw new AuditChainError('la cabeza de la cadena no tiene chain_hash.')
  return { sequence: parseAuditInteger(row.sequence, 'sequence'), chainHash: row.chain_hash }
}

async function appendEvent(
  req: PayloadRequest,
  event: PendingAuditEvent,
  head: ChainHead | null,
  keys: AuditKeys
): Promise<ChainHead> {
  const { draft } = event
  const created_at = new Date().toISOString()
  const hmac_key_id = keys.hmac.activeKeyId
  const binding = { chain_id: draft.chain_id, event_id: draft.id }

  const network = event.network
    ? {
        digest: computeNetworkDigest(
          { ...binding, context: event.network },
          hmac_key_id,
          keys.hmac.keys
        ),
        expiresAt: new Date(
          Date.parse(created_at) + AUDIT_NETWORK_RETENTION_DAYS * DAY_MS
        ).toISOString(),
        encrypted: encryptNetworkContext(event.network, binding, keys.network),
      }
    : null

  const envelope = parseAuditEnvelope({
    ...draft,
    sequence: (head?.sequence ?? 0) + 1,
    created_at,
    previous_hash: head?.chainHash ?? null,
    hmac_key_id,
    network_digest: network?.digest ?? null,
    network_expires_at: network?.expiresAt ?? null,
  })
  const chain_hash = computeChainHash(envelope, keys.hmac.keys)

  // Copia sin congelar: Payload puede tocar el objeto de datos; lo firmado ya está calculado.
  const created = await createInternal(
    req,
    'audit-logs',
    structuredClone({ ...envelope, chain_hash })
  )
  if (created.id !== envelope.id)
    throw new AuditChainError('la base no guardó el id del evento (el HMAC lo incluye).')
  if (network) {
    const { v, ...stored } = network.encrypted
    await createInternal(req, 'audit-network-contexts', {
      event_id: envelope.id,
      chain_id: envelope.chain_id,
      cipher_version: v,
      ...stored,
    })
  }
  return { sequence: envelope.sequence, chainHash: chain_hash }
}

async function createInternal(
  req: PayloadRequest,
  collection: 'audit-logs' | 'audit-network-contexts',
  data: Record<string, unknown>
): Promise<{ id: string | number }> {
  const context = internalAuditWriteContext()
  try {
    return await req.payload.create({
      collection,
      data: data as never,
      overrideAccess: true,
      context,
      req,
      depth: 0,
    })
  } finally {
    revokeInternalAuditWrite(context)
  }
}
