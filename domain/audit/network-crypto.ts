import { createCipheriv, createDecipheriv, randomBytes, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { auditCanonicalJson } from './canonical'
import { AUDIT_KEY_ID_PATTERN, type AuditKeyring } from './config'
import { parseNetworkContext, type NetworkContextV1 } from './network-context'

// AES-256-GCM del contexto de red (documentation/planes/audit-log/03-seguridad-y-claves.md §3),
// solo con node:crypto. Una fila de AuditNetworkContexts por evento, fuera de la cadena:
// - clave de 32 bytes del llavero AUDIT_NETWORK_KEYS (separado del HMAC);
// - nonce aleatorio de 12 bytes por cifrado (randomBytes), nunca reutilizado ni derivado de
//   la hora;
// - tag de 16 bytes, declarado también al descifrar: sin authTagLength, Node acepta tags más
//   cortos y la autenticación se debilita;
// - AAD = JSON canónico de {chain_id, event_id, key_id, v}: el ciphertext no se puede mover a
//   otro evento o cadena, ni cambiar su versión de clave o de formato.
// Los errores no incluyen la IP, la clave ni el ciphertext.

export const AUDIT_NETWORK_CIPHER_VERSION = 1

const NONCE_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = 'aes-256-gcm'

export interface NetworkContextBinding {
  chain_id: string
  event_id: string
}

/** Lo que se guarda en AuditNetworkContexts (además de event_id y chain_id). Base64 estándar. */
export interface EncryptedNetworkContext {
  v: typeof AUDIT_NETWORK_CIPHER_VERSION
  key_id: string
  nonce: string
  tag: string
  ciphertext: string
}

export class AuditNetworkKeyMissingError extends Error {
  constructor(readonly keyId: string) {
    super(`La clave de red "${keyId}" del AuditLog no está en el llavero.`)
    this.name = 'AuditNetworkKeyMissingError'
  }
}

/** El contexto no se pudo autenticar o leer: alterado, movido de evento o con otra clave. */
export class AuditNetworkDecryptError extends Error {
  constructor(readonly reason: string) {
    super(`No se pudo descifrar el contexto de red del AuditLog: ${reason}.`)
    this.name = 'AuditNetworkDecryptError'
  }
}

/** Cifra el contexto (validado) con la clave activa del llavero de red y un nonce nuevo. */
export function encryptNetworkContext(
  context: unknown,
  binding: NetworkContextBinding,
  keyring: AuditKeyring
): EncryptedNetworkContext {
  const plaintext = Buffer.from(auditCanonicalJson(parseNetworkContext(context)), 'utf8')
  const key_id = keyring.activeKeyId
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyring.active, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(networkContextAad(binding, key_id))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    v: AUDIT_NETWORK_CIPHER_VERSION,
    key_id,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** Descifra y valida un contexto guardado, con la versión de clave que nombra su key_id. */
export function decryptNetworkContext(
  stored: unknown,
  binding: NetworkContextBinding,
  keys: ReadonlyMap<string, KeyObject>
): NetworkContextV1 {
  const parsed = StoredSchema.safeParse(stored)
  if (!parsed.success) throw new AuditNetworkDecryptError('el formato guardado no es el v1')
  const { key_id, nonce, tag, ciphertext } = parsed.data

  const key = keys.get(key_id)
  if (!key) throw new AuditNetworkKeyMissingError(key_id)

  const plaintext = decryptAesGcm(
    key,
    Buffer.from(nonce, 'base64'),
    networkContextAad(binding, key_id),
    Buffer.from(ciphertext, 'base64'),
    Buffer.from(tag, 'base64')
  )
  let context: unknown
  try {
    context = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new AuditNetworkDecryptError('el contenido descifrado no es JSON')
  }
  return parseNetworkContext(context)
}

/**
 * AES-256-GCM al descifrar, con nonce de 12 bytes y tag de exactamente 16. Exportada para
 * probarla contra el vector publicado de la especificación de GCM; el resto del código usa
 * decryptNetworkContext.
 */
export function decryptAesGcm(
  key: KeyObject | Buffer,
  nonce: Buffer,
  aad: Buffer,
  ciphertext: Buffer,
  tag: Buffer
): Buffer {
  if (nonce.length !== NONCE_BYTES) throw new AuditNetworkDecryptError('nonce de largo inválido')
  if (tag.length !== TAG_BYTES) throw new AuditNetworkDecryptError('tag de largo inválido')
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new AuditNetworkDecryptError('la autenticación falló')
  }
}

/** AAD: JSON canónico (UTF-8) de chain_id, event_id, key_id y versión de formato. */
export function networkContextAad(binding: NetworkContextBinding, keyId: string): Buffer {
  const { chain_id, event_id } = binding
  const aad = { chain_id, event_id, key_id: keyId, v: AUDIT_NETWORK_CIPHER_VERSION }
  return Buffer.from(auditCanonicalJson(aad), 'utf8')
}

/** Base64 estándar y canónico de un largo exacto, o de al menos 1 byte si no se indica. */
function base64Of(bytes?: number) {
  return z.string().refine(value => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false
    const decoded = Buffer.from(value, 'base64')
    if (decoded.toString('base64') !== value) return false
    return bytes === undefined ? decoded.length > 0 : decoded.length === bytes
  })
}

const StoredSchema = z.strictObject({
  v: z.literal(AUDIT_NETWORK_CIPHER_VERSION),
  key_id: z.string().regex(AUDIT_KEY_ID_PATTERN),
  nonce: base64Of(NONCE_BYTES),
  tag: base64Of(TAG_BYTES),
  ciphertext: base64Of(),
})
