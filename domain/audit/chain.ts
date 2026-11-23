import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'
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
// el mismo cliente (Tani, 23/11; pg@9 deja de admitirlo).
//
// Transacciones REPEATABLE READ o SERIALIZABLE (cambio a 03 §4.4 decidido por Tani el 23/11, con
// los números del prototipo de concurrencia): toman el lock al cerrar, como todas, y leen la cabeza
// FUERA de su foto, con una consulta READ COMMITTED aparte, mientras retienen el lock: nadie más
// puede agregar a la cadena, así que la cabeza leída es la última confirmada. Su foto se fijó al
// empezar y no ve los eventos que otros confirmaron después; leer la cabeza ahí daría una cabeza
// vieja (23505 y reintento del comando entero). La lectura aparte usa un pool propio y chico, no el
// de Payload: tomar una segunda conexión del pool principal mientras la transacción retiene la
// primera puede trabarlo cuando varios cierres coinciden con el pool lleno. Si en
// AUDIT_HEAD_READ_TIMEOUT_MS no hay conexión libre, falla con un error claro (la transacción se
// revierte). La restricción única (chain_id, sequence) sigue siendo la última defensa.

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

/** Tiempo máximo para conseguir una conexión del pool de lectura de cabezas. */
export const AUDIT_HEAD_READ_TIMEOUT_MS = 5000
const HEAD_POOL_MAX = 2

// Tipos mínimos de pg-pool (el repo no tiene @types/pg como dependencia directa). El pool de
// lectura se crea con el mismo constructor que el de Payload: no se importa pg.
interface HeadClient {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>
  release(): void
}
interface HeadPool {
  options: Record<string, unknown>
  connect(): Promise<HeadClient>
  end(): Promise<void>
  on(event: 'error', listener: () => void): void
}
type HeadPoolConstructor = new (options: Record<string, unknown>) => HeadPool

// Un pool de lectura por pool de Payload, compartido entre copias del módulo (como el buffer).
const HEAD_POOLS_KEY = Symbol.for('siam.audit.head-pools')
const registry = globalThis as typeof globalThis & { [HEAD_POOLS_KEY]?: WeakMap<object, HeadPool> }
const headPools: WeakMap<object, HeadPool> = (registry[HEAD_POOLS_KEY] ??= new WeakMap())

function mainPool(payload: Payload): HeadPool {
  const pool = (payload.db as unknown as { pool?: HeadPool }).pool
  if (!pool) throw new AuditChainError('el adaptador de base no expone su pool de conexiones.')
  return pool
}

/**
 * Crea (o recrea) el pool de lectura de cabezas: mismas credenciales que Payload, pocas conexiones,
 * que se cierran solas al quedar libres y no impiden que el proceso termine. Los tests lo usan para
 * achicarlo o acortar el tiempo de espera.
 */
export function configureAuditHeadPool(
  payload: Payload,
  options: { max?: number; timeoutMs?: number } = {}
): HeadPool {
  const main = mainPool(payload)
  const previous = headPools.get(main)
  if (previous) void previous.end().catch(() => {})
  const Pool = main.constructor as HeadPoolConstructor
  const pool = new Pool({
    ...main.options,
    max: options.max ?? HEAD_POOL_MAX,
    min: 0,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: options.timeoutMs ?? AUDIT_HEAD_READ_TIMEOUT_MS,
    allowExitOnIdle: true,
  })
  pool.on('error', () => {}) // un cliente libre que se cae no tiene que tirar el proceso
  headPools.set(main, pool)
  return pool
}

function headPool(payload: Payload): HeadPool {
  return headPools.get(mainPool(payload)) ?? configureAuditHeadPool(payload)
}

async function readsOutsideSnapshot(req: PayloadRequest): Promise<boolean> {
  const result = await (
    await transactionDb(req)
  ).execute(sql`SELECT current_setting('transaction_isolation') AS isolation`)
  return (result.rows[0] as { isolation?: unknown } | undefined)?.isolation !== 'read committed'
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

  const outsideSnapshot = await readsOutsideSnapshot(req)
  for (const chainId of [...byChain.keys()].sort()) {
    await transactionLock(req, auditChainLockKey(chainId))
    let head = outsideSnapshot
      ? await readCommittedHead(req.payload, chainId)
      : await readChainHead(req, chainId)
    for (const event of byChain.get(chainId)!) head = await appendEvent(req, event, head, keys)
  }
}

/** Cabeza dentro de la transacción (READ COMMITTED: cada consulta ve lo último confirmado). */
async function readChainHead(req: PayloadRequest, chainId: string): Promise<ChainHead | null> {
  const db = await transactionDb(req)
  const result = await db.execute(
    sql`SELECT sequence, chain_hash FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence DESC LIMIT 1`
  )
  return parseHead(result.rows[0])
}

/** Cabeza confirmada, leída fuera de la transacción (que retiene el lock de la cadena). */
async function readCommittedHead(payload: Payload, chainId: string): Promise<ChainHead | null> {
  let client: HeadClient
  try {
    client = await headPool(payload).connect()
  } catch (error) {
    if (error instanceof Error && /timeout/i.test(error.message))
      throw new AuditChainError(
        'no hubo una conexión libre para leer la cabeza de la cadena a tiempo (pool de lectura del AuditLog agotado).'
      )
    throw error
  }
  try {
    const result = await client.query(
      'SELECT sequence, chain_hash FROM audit_logs WHERE chain_id = $1 ORDER BY sequence DESC LIMIT 1',
      [chainId]
    )
    return parseHead(result.rows[0])
  } finally {
    client.release()
  }
}

function parseHead(value: unknown): ChainHead | null {
  const row = value as { sequence?: unknown; chain_hash?: unknown } | undefined
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
