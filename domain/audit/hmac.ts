import { createHmac, timingSafeEqual, type KeyObject } from 'node:crypto'
import { auditCanonicalJson } from './canonical'
import { parseAuditEnvelope } from './envelope'
import { parseNetworkContext } from './network-context'

// HMAC-SHA256 del AuditLog (documentation/planes/audit-log/03-seguridad-y-claves.md §3), solo
// con node:crypto. Dos usos de la misma clave HMAC, separados por una etiqueta fija al
// principio del mensaje para que el texto de uno nunca pueda pasar por el otro:
// - chain_hash: el sobre v1 completo (incluye hmac_key_id y previous_hash);
// - network_digest: el contexto de red en claro, junto con event_id y chain_id (decisión D1,
//   22/11). Con event_id adentro, dos eventos con la misma IP no tienen el mismo digest.
// Salida en hex en minúsculas. Las claves llegan como KeyObject (config.ts) y nunca se
// imprimen; los errores nombran el id de la clave, no la clave.

export const AUDIT_EVENT_HASH_LABEL = 'siam.audit.event.v1'
export const AUDIT_NETWORK_DIGEST_LABEL = 'siam.audit.network.v1'

/** Versiones de la clave HMAC por id: el llavero completo (AuditKeyring.keys). */
export type AuditHmacKeys = ReadonlyMap<string, KeyObject>

/** El sobre nombra una versión de clave que no está en el llavero: no es lo mismo que un hash incorrecto (03 §7). */
export class AuditKeyMissingError extends Error {
  constructor(readonly keyId: string) {
    super(`La clave HMAC "${keyId}" del AuditLog no está en el llavero.`)
    this.name = 'AuditKeyMissingError'
  }
}

/** Texto exacto que se firma como chain_hash. Valida el sobre antes. */
export function chainHashInput(envelope: unknown): string {
  return `${AUDIT_EVENT_HASH_LABEL}\n${auditCanonicalJson(parseAuditEnvelope(envelope))}`
}

/** chain_hash del sobre, con la versión de clave que nombra su hmac_key_id. */
export function computeChainHash(envelope: unknown, keys: AuditHmacKeys): string {
  const valid = parseAuditEnvelope(envelope)
  return hmacHex(keyFor(keys, valid.hmac_key_id), chainHashInput(valid))
}

export interface NetworkDigestInput {
  chain_id: string
  event_id: string
  /** Contexto de red en claro; se valida con el esquema de network-context.ts. */
  context: unknown
}

/** Texto exacto que se firma como network_digest. Valida el contexto antes. */
export function networkDigestInput(input: NetworkDigestInput): string {
  const { chain_id, event_id } = input
  const context = parseNetworkContext(input.context)
  return `${AUDIT_NETWORK_DIGEST_LABEL}\n${auditCanonicalJson({ chain_id, context, event_id })}`
}

/** network_digest: con la misma versión de clave HMAC que el evento (su hmac_key_id). */
export function computeNetworkDigest(
  input: NetworkDigestInput,
  keyId: string,
  keys: AuditHmacKeys
): string {
  return hmacHex(keyFor(keys, keyId), networkDigestInput(input))
}

/**
 * Compara dos hashes en tiempo constante. timingSafeEqual exige el mismo largo y si no lanza
 * un error: con largos distintos se devuelve false (el largo de un hash no es secreto).
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function keyFor(keys: AuditHmacKeys, keyId: string): KeyObject {
  const key = keys.get(keyId)
  if (!key) throw new AuditKeyMissingError(keyId)
  return key
}

function hmacHex(key: KeyObject, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex')
}
