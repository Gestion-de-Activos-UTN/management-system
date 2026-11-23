import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { AuditChainError, parseAuditInteger } from './chain'
import type { AuditKeys } from './config'
import {
  AUDIT_ENVELOPE_VERSION,
  AuditEnvelopeError,
  parseAuditEnvelope,
  type AuditEnvelopeV1,
} from './envelope'
import { AuditKeyMissingError, computeChainHash, computeNetworkDigest, hashesEqual } from './hmac'
import {
  AuditNetworkDecryptError,
  AuditNetworkKeyMissingError,
  decryptNetworkContext,
} from './network-crypto'
import { getAuditKeys } from './runtime-keys'

// Verificador local de solo lectura (documentation/planes/audit-log/03-seguridad-y-claves.md §7).
// Por cada cadena, en orden de sequence: secuencias sin huecos, enlace con el evento anterior,
// HMAC del sobre (distingue clave ausente de hash incorrecto) y contexto de red (descifra, compara
// con el digest firmado y marca como anomalía un contexto que falte antes de vencer). Informa el
// primer error de cada cadena y el rango verificado, y la cabeza de cada cadena para anotarla fuera
// del sistema. Nunca devuelve ni imprime payloads, IPs ni claves.
//
// Lee por SQL directo, en lotes (keyset por sequence), dentro de una transacción REPEATABLE READ de
// solo lectura: una foto coherente y sin cargar toda la cadena en memoria. Rearma el sobre campo
// por campo, con conversiones explícitas: `numeric` llega como texto ("2" no firma igual que 2) y
// solo se acepta un entero exacto; las fechas se piden en UTC con milisegundos; el payload se lee
// como texto y se parsea; office_ids sale de audit_logs_texts en su orden.
//
// Límite conocido (03 §7): no detecta que se borren los últimos eventos de una cadena (la cola
// restante sigue siendo válida), ni una reescritura completa hecha por alguien con acceso a la base
// y a la clave. Por eso informa la cabeza: compararla con una copia guardada en otro lado.

export const AUDIT_VERIFY_DEFAULT_BATCH = 500
const MAX_ANOMALIES_PER_CHAIN = 20

export type AuditVerifyErrorKind =
  | 'sequence_invalid'
  | 'sequence_gap'
  | 'broken_link'
  | 'envelope_invalid'
  | 'unknown_version'
  | 'key_missing'
  | 'hash_mismatch'

export type AuditVerifyAnomalyKind =
  | 'network_context_missing'
  | 'network_context_unexpected'
  | 'network_context_invalid'
  | 'network_key_missing'
  | 'network_digest_mismatch'

export interface AuditVerifyError {
  kind: AuditVerifyErrorKind
  /** Secuencia donde se encontró (la esperada, si la guardada no es un entero). */
  sequence: number
  eventId: string
  detail: string
}

export interface AuditVerifyAnomaly {
  kind: AuditVerifyAnomalyKind
  sequence: number
  eventId: string
}

export interface AuditChainReport {
  chainId: string
  /** Último evento guardado (por sequence), aunque la cadena tenga errores. */
  head: { sequence: string; chainHash: string } | null
  /** Eventos verificados en orden desde la secuencia 1 (hasta el anterior al primer error). */
  verified: number
  error: AuditVerifyError | null
  anomalies: AuditVerifyAnomaly[]
  /** Anomalías no listadas por superar el máximo por cadena. */
  moreAnomalies: number
  batches: number
}

export interface AuditVerifyReport {
  chains: AuditChainReport[]
  /** Contextos de red cuyo evento no existe. */
  orphanNetworkContexts: number
  ok: boolean
}

export interface AuditVerifyOptions {
  /** Solo estas cadenas (por defecto, todas). */
  chainIds?: readonly string[]
  batchSize?: number
  /** Para decidir si un contexto de red faltante ya venció (por defecto, ahora). */
  now?: Date
  /** Por defecto, los llaveros del proceso. */
  keys?: AuditKeys
}

type Db = PostgresAdapter['drizzle']

interface StoredRow extends Record<string, unknown> {
  id: string
  sequence: string
  chain_hash: unknown
}

/** Verifica las cadenas en una foto coherente de la base (transacción de solo lectura). */
export async function verifyAuditChains(
  payload: Payload,
  options: AuditVerifyOptions = {}
): Promise<AuditVerifyReport> {
  const keys = options.keys ?? getAuditKeys()
  const batchSize = options.batchSize ?? AUDIT_VERIFY_DEFAULT_BATCH
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('batchSize inválido.')
  const now = options.now ?? new Date()

  const transaction = await payload.db.beginTransaction({
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  } as never)
  if (!transaction) throw new Error('El verificador necesita transacciones de PostgreSQL.')
  try {
    const db = payload.db.sessions![transaction]!.db as unknown as Db
    const chainIds = options.chainIds ? [...new Set(options.chainIds)].sort() : await listChains(db)
    const chains: AuditChainReport[] = []
    for (const chainId of chainIds)
      chains.push(await verifyChain(db, chainId, { keys, batchSize, now }))
    const orphanNetworkContexts = await countOrphanContexts(db, options.chainIds)
    const ok =
      orphanNetworkContexts === 0 && chains.every(c => !c.error && c.anomalies.length === 0)
    return { chains, orphanNetworkContexts, ok }
  } finally {
    await payload.db.rollbackTransaction(transaction)
  }
}

async function listChains(db: Db): Promise<string[]> {
  const chains: string[] = []
  let last: string | null = null
  for (;;) {
    const result: { rows: unknown[] } = await db.execute(
      last === null
        ? sql`SELECT DISTINCT chain_id FROM audit_logs ORDER BY chain_id LIMIT 1000`
        : sql`SELECT DISTINCT chain_id FROM audit_logs WHERE chain_id > ${last} ORDER BY chain_id LIMIT 1000`
    )
    const batch: string[] = result.rows.map(row => String((row as { chain_id: unknown }).chain_id))
    chains.push(...batch)
    if (batch.length < 1000) return chains
    last = batch[batch.length - 1]!
  }
}

async function verifyChain(
  db: Db,
  chainId: string,
  context: { keys: AuditKeys; batchSize: number; now: Date }
): Promise<AuditChainReport> {
  const report: AuditChainReport = {
    chainId,
    head: await readHead(db, chainId),
    verified: 0,
    error: null,
    anomalies: [],
    moreAnomalies: 0,
    batches: 0,
  }
  let previousHash: string | null = null
  let lastSequence: string | null = null
  let expected = 1

  for (;;) {
    const rows = await readBatch(db, chainId, lastSequence, context.batchSize)
    if (rows.length === 0) return report
    report.batches += 1
    const officeIds = await readOfficeIds(db, rows)
    const networkContexts = await readNetworkContexts(db, rows)

    for (const row of rows) {
      const fail = (kind: AuditVerifyErrorKind, detail: string) => {
        report.error = { kind, sequence: expected, eventId: row.id, detail }
        return report
      }

      let sequence: number
      try {
        sequence = parseAuditInteger(row.sequence, 'sequence')
      } catch (error) {
        if (!(error instanceof AuditChainError)) throw error
        return fail('sequence_invalid', 'sequence no es un entero exacto.')
      }
      if (sequence !== expected)
        return fail('sequence_gap', `falta la secuencia ${expected} (sigue la ${sequence}).`)
      if (row.previous_hash !== previousHash)
        return fail('broken_link', 'previous_hash no es el chain_hash del evento anterior.')

      let envelope: AuditEnvelopeV1
      try {
        envelope = rebuildEnvelope(row, officeIds.get(row.id) ?? [])
      } catch (error) {
        if (error instanceof UnknownVersionError) return fail('unknown_version', error.message)
        if (error instanceof AuditEnvelopeError || error instanceof AuditChainError)
          return fail('envelope_invalid', error.message.split('\n').slice(0, 4).join(' '))
        throw error
      }

      let computed: string
      try {
        computed = computeChainHash(envelope, context.keys.hmac.keys)
      } catch (error) {
        if (error instanceof AuditKeyMissingError)
          return fail('key_missing', `la clave HMAC "${error.keyId}" no está en el llavero.`)
        throw error
      }
      if (typeof row.chain_hash !== 'string' || !hashesEqual(computed, row.chain_hash))
        return fail('hash_mismatch', 'el HMAC recalculado no coincide con chain_hash.')

      const anomaly = checkNetworkContext(envelope, networkContexts.get(row.id), context)
      if (anomaly) {
        if (report.anomalies.length < MAX_ANOMALIES_PER_CHAIN)
          report.anomalies.push({ kind: anomaly, sequence, eventId: row.id })
        else report.moreAnomalies += 1
      }

      report.verified += 1
      previousHash = row.chain_hash
      expected += 1
    }
    lastSequence = rows[rows.length - 1]!.sequence
  }
}

function checkNetworkContext(
  envelope: AuditEnvelopeV1,
  stored: Record<string, unknown> | undefined,
  context: { keys: AuditKeys; now: Date }
): AuditVerifyAnomalyKind | null {
  if (envelope.network_digest === null) return stored ? 'network_context_unexpected' : null
  if (!stored) {
    // Después de network_expires_at la purga lo borra (03 §8); antes, falta.
    return Date.parse(envelope.network_expires_at!) > context.now.getTime()
      ? 'network_context_missing'
      : null
  }
  const binding = { chain_id: envelope.chain_id, event_id: envelope.id }
  try {
    const decrypted = decryptNetworkContext(
      {
        v: parseAuditInteger(stored.cipher_version, 'cipher_version'),
        key_id: stored.key_id,
        nonce: stored.nonce,
        tag: stored.tag,
        ciphertext: stored.ciphertext,
      },
      binding,
      context.keys.network.keys
    )
    const digest = computeNetworkDigest(
      { ...binding, context: decrypted },
      envelope.hmac_key_id,
      context.keys.hmac.keys
    )
    return hashesEqual(digest, envelope.network_digest) ? null : 'network_digest_mismatch'
  } catch (error) {
    if (error instanceof AuditNetworkKeyMissingError) return 'network_key_missing'
    if (error instanceof AuditNetworkDecryptError || error instanceof AuditChainError)
      return 'network_context_invalid'
    throw error
  }
}

class UnknownVersionError extends Error {}

const ENVELOPE_TEXT_FIELDS = [
  'id',
  'scope_kind',
  'chain_id',
  'organization_id',
  'occurred_at',
  'created_at',
  'category_code',
  'action_code',
  'section_code',
  'entity_type',
  'entity_id',
  'actor_type',
  'actor_id',
  'actor_collection',
  'actor_role',
  'initiated_by_type',
  'initiated_by_id',
  'operation_id',
  'parent_event_id',
  'visit_id',
  'origin',
  'outcome',
  'network_digest',
  'network_expires_at',
  'hmac_key_id',
  'previous_hash',
] as const

/** Rearma el sobre v1 desde la fila, campo por campo (sin chain_hash), y lo valida. */
function rebuildEnvelope(row: StoredRow, officeIds: string[]): AuditEnvelopeV1 {
  const version = parseAuditInteger(row.schema_version, 'schema_version')
  if (version !== AUDIT_ENVELOPE_VERSION)
    throw new UnknownVersionError(`versión de sobre ${version} desconocida para este verificador.`)
  const envelope: Record<string, unknown> = {
    schema_version: version,
    sequence: parseAuditInteger(row.sequence, 'sequence'),
    office_ids: officeIds,
    payload: parsePayload(row.payload),
  }
  for (const field of ENVELOPE_TEXT_FIELDS) {
    const value = row[field]
    if (value !== null && typeof value !== 'string')
      throw new AuditChainError(`${field} no es texto.`)
    envelope[field] = value
  }
  return parseAuditEnvelope(envelope)
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') throw new AuditChainError('payload no llegó como texto.')
  try {
    return JSON.parse(value)
  } catch {
    throw new AuditChainError('payload no es JSON.')
  }
}

const utc = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ${column}`)

async function readBatch(
  db: Db,
  chainId: string,
  after: string | null,
  limit: number
): Promise<StoredRow[]> {
  const columns = sql`id, schema_version::text AS schema_version, scope_kind, chain_id, organization_id,
    sequence::text AS sequence, ${utc('created_at')}, ${utc('occurred_at')}, category_code, action_code,
    section_code, entity_type, entity_id, actor_type, actor_id, actor_collection, actor_role,
    initiated_by_type, initiated_by_id, operation_id, parent_event_id, visit_id, origin, outcome,
    payload::text AS payload, network_digest, ${utc('network_expires_at')}, hmac_key_id,
    previous_hash, chain_hash`
  const result = await db.execute(
    after === null
      ? sql`SELECT ${columns} FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence LIMIT ${limit}`
      : sql`SELECT ${columns} FROM audit_logs WHERE chain_id = ${chainId} AND sequence > ${after}::numeric ORDER BY sequence LIMIT ${limit}`
  )
  return result.rows as StoredRow[]
}

const idList = (rows: StoredRow[]) =>
  sql.join(
    rows.map(row => sql`${row.id}`),
    sql`, `
  )

async function readOfficeIds(db: Db, rows: StoredRow[]): Promise<Map<string, string[]>> {
  const result = await db.execute(
    sql`SELECT parent_id, "text" FROM audit_logs_texts WHERE path = 'office_ids' AND parent_id IN (${idList(rows)}) ORDER BY parent_id, "order"`
  )
  const byEvent = new Map<string, string[]>()
  for (const row of result.rows as Array<{ parent_id: string; text: unknown }>) {
    const list = byEvent.get(row.parent_id) ?? []
    list.push(typeof row.text === 'string' ? row.text : '')
    byEvent.set(row.parent_id, list)
  }
  return byEvent
}

async function readNetworkContexts(
  db: Db,
  rows: StoredRow[]
): Promise<Map<string, Record<string, unknown>>> {
  const result = await db.execute(
    sql`SELECT event_id, chain_id, cipher_version::text AS cipher_version, key_id, nonce, tag, ciphertext
      FROM audit_network_contexts WHERE event_id IN (${idList(rows)})`
  )
  return new Map(
    (result.rows as Array<Record<string, unknown>>).map(row => [String(row.event_id), row])
  )
}

async function readHead(db: Db, chainId: string): Promise<AuditChainReport['head']> {
  const result = await db.execute(
    sql`SELECT sequence::text AS sequence, chain_hash FROM audit_logs WHERE chain_id = ${chainId} ORDER BY sequence DESC LIMIT 1`
  )
  const row = result.rows[0] as { sequence: string; chain_hash: unknown } | undefined
  return row ? { sequence: row.sequence, chainHash: String(row.chain_hash) } : null
}

async function countOrphanContexts(db: Db, chainIds?: readonly string[]): Promise<number> {
  const scope =
    chainIds && chainIds.length > 0
      ? sql`AND c.chain_id IN (${sql.join(
          chainIds.map(id => sql`${id}`),
          sql`, `
        )})`
      : sql``
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM audit_network_contexts c
      WHERE NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.id = c.event_id) ${scope}`
  )
  return (result.rows[0] as { n: number }).n
}

/** Texto para la terminal: sin payloads, IPs ni claves. */
export function formatAuditVerifyReport(report: AuditVerifyReport): string {
  const lines = ['AuditLog · verificación local de cadenas', '']
  let events = 0
  for (const chain of report.chains) {
    events += chain.verified
    const head = chain.head
      ? `cabeza ${chain.head.sequence} ${chain.head.chainHash}`
      : 'sin eventos'
    if (chain.error) {
      const range = chain.verified > 0 ? `verificado 1–${chain.verified}` : 'nada verificado'
      lines.push(
        `✖ ${chain.chainId}: ERROR en la secuencia ${chain.error.sequence} (evento ${chain.error.eventId}): ${errorLabel(chain.error.kind)}. ${chain.error.detail} ${range}.`
      )
    } else {
      lines.push(`✔ ${chain.chainId}: OK, eventos 1–${chain.verified}.`)
    }
    lines.push(`  ${head}`)
    for (const anomaly of chain.anomalies)
      lines.push(
        `  ⚠ secuencia ${anomaly.sequence} (evento ${anomaly.eventId}): ${anomalyLabel(anomaly.kind)}.`
      )
    if (chain.moreAnomalies > 0) lines.push(`  ⚠ y ${chain.moreAnomalies} anomalía(s) más.`)
  }
  if (report.orphanNetworkContexts > 0)
    lines.push(`⚠ ${report.orphanNetworkContexts} contexto(s) de red sin su evento.`)
  const failed = report.chains.filter(chain => chain.error || chain.anomalies.length > 0).length
  lines.push(
    '',
    `Resumen: ${report.chains.length} cadena(s), ${report.chains.length - failed} sin problemas, ${failed} con errores o anomalías; ${events} evento(s) verificados.`,
    '',
    'Límite conocido: esta verificación es local. No detecta que se borren los últimos eventos de',
    'una cadena (lo que queda sigue siendo válido) ni una reescritura completa hecha con acceso a la',
    'base y a la clave HMAC. Para detectar un borrado de la cola, guardar las cabezas de arriba fuera',
    'del sistema y compararlas en la próxima verificación.'
  )
  return lines.join('\n')
}

function errorLabel(kind: AuditVerifyErrorKind): string {
  return {
    sequence_invalid: 'secuencia inválida',
    sequence_gap: 'hueco en la secuencia',
    broken_link: 'enlace roto',
    envelope_invalid: 'sobre inválido',
    unknown_version: 'versión de sobre desconocida',
    key_missing: 'clave HMAC ausente (no es lo mismo que un hash incorrecto)',
    hash_mismatch: 'hash incorrecto',
  }[kind]
}

function anomalyLabel(kind: AuditVerifyAnomalyKind): string {
  return {
    network_context_missing: 'falta el contexto de red antes de su vencimiento',
    network_context_unexpected: 'hay un contexto de red para un evento sin digest',
    network_context_invalid: 'el contexto de red no descifra (alterado o movido de evento)',
    network_key_missing: 'la clave del contexto de red no está en el llavero',
    network_digest_mismatch: 'el contexto de red no coincide con su digest',
  }[kind]
}
