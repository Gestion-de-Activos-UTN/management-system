import { createSecretKey, type KeyObject } from 'node:crypto'

// Llaveros del AuditLog: lectura y validación estricta de las variables de entorno
// (documentation/planes/audit-log/03-seguridad-y-claves.md §5). Librería pura: no lee
// process.env por su cuenta, no imprime nada y todavía nadie la llama al arrancar (F1b).
//
// Formato de cada llavero: `id:base64,id:base64` (decisión G3, 22/11). Ni los ids (ver
// AUDIT_KEY_ID_PATTERN) ni el base64 estándar contienen ':' ni ',', así que un par es lo que
// hay entre comas y se parte en el único ':'. No se corrige nada en silencio: espacios,
// entradas vacías, comas al final o pares mal formados son errores.
//
// Los errores nombran la variable y la posición (1 = primer par), nunca el valor: ni la
// clave ni el id. Las claves salen como KeyObject, que al imprimirse (console.log,
// util.inspect, JSON.stringify) no muestra los bytes.

export const AUDIT_KEY_VARIABLES = {
  hmac: { keys: 'AUDIT_HMAC_KEYS', activeKeyId: 'AUDIT_HMAC_ACTIVE_KEY_ID' },
  network: { keys: 'AUDIT_NETWORK_KEYS', activeKeyId: 'AUDIT_NETWORK_ACTIVE_KEY_ID' },
} as const

/** Minúsculas, dígitos y guiones; 3 a 64 caracteres; empieza con letra o dígito. */
export const AUDIT_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/

/**
 * Prefijo de las claves de desarrollo. En producción no se admite ninguna, ni siquiera como
 * versión vieja: el verificador acepta cualquier clave del llavero, y las de desarrollo están
 * en las notebooks del equipo, así que con una de ellas se podrían fabricar eventos que
 * verifican. Producción nunca firma con claves dev-.
 */
export const AUDIT_DEV_KEY_PREFIX = 'dev-'

export const AUDIT_KEY_BYTES = 32

/** Base64 estándar de 32 bytes: 43 caracteres más un '=' de relleno (`openssl rand -base64 32`). */
const KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/

export type AuditKeyErrorCode =
  | 'missing'
  | 'empty'
  | 'empty_entry'
  | 'trailing_comma'
  | 'whitespace'
  | 'missing_separator'
  | 'extra_separator'
  | 'invalid_id'
  | 'invalid_key'
  | 'duplicate_id'
  | 'duplicate_key'
  | 'shared_key'
  | 'active_unknown'
  | 'dev_key_in_production'

export interface AuditKeyError {
  variable: string
  /** Par del llavero (1 = el primero). Ausente si el error es de la variable entera. */
  position?: number
  code: AuditKeyErrorCode
  message: string
}

export interface AuditKeyring {
  activeKeyId: string
  active: KeyObject
  /** Todas las versiones, en el orden de la variable. Incluye la activa. */
  keys: ReadonlyMap<string, KeyObject>
}

export interface AuditKeys {
  hmac: AuditKeyring
  network: AuditKeyring
}

export type AuditKeysResult =
  { ok: true; keys: AuditKeys } | { ok: false; errors: readonly AuditKeyError[] }

type Env = Readonly<Record<string, string | undefined>>

interface ParsedEntry {
  position: number
  id: string
  bytes: Buffer
}

/** Valida los dos llaveros y devuelve todas las fallas juntas, sin valores. */
export function parseAuditKeys(env: Env, options: { production: boolean }): AuditKeysResult {
  const errors: AuditKeyError[] = []
  const hmac = parseKeyring(env, AUDIT_KEY_VARIABLES.hmac, options, errors)
  const network = parseKeyring(env, AUDIT_KEY_VARIABLES.network, options, errors)
  checkSharedKeys(hmac.entries, network.entries, errors)

  if (errors.length > 0 || !hmac.keyring || !network.keyring) return { ok: false, errors }
  return { ok: true, keys: { hmac: hmac.keyring, network: network.keyring } }
}

/** Una línea por error, para el mensaje de arranque o de un script. */
export function formatAuditKeyErrors(errors: readonly AuditKeyError[]): string {
  return errors.map(error => `- ${error.message}`).join('\n')
}

function parseKeyring(
  env: Env,
  names: { keys: string; activeKeyId: string },
  options: { production: boolean },
  errors: AuditKeyError[]
): { entries: ParsedEntry[]; keyring?: AuditKeyring } {
  const before = errors.length
  const entries = parseEntries(names.keys, env[names.keys], options, errors)
  const keyringOk = errors.length === before

  const activeKeyId = parseActiveKeyId(names.activeKeyId, env[names.activeKeyId], errors)
  if (activeKeyId === undefined || !keyringOk) return { entries }

  const active = entries.find(entry => entry.id === activeKeyId)
  if (!active) {
    push(
      errors,
      names.activeKeyId,
      undefined,
      'active_unknown',
      `no coincide con ningún id de ${names.keys}`
    )
    return { entries }
  }
  if (errors.length > before) return { entries }

  const keys = new Map(entries.map(entry => [entry.id, createSecretKey(entry.bytes)]))
  return { entries, keyring: { activeKeyId, active: keys.get(activeKeyId)!, keys } }
}

function parseEntries(
  variable: string,
  value: string | undefined,
  options: { production: boolean },
  errors: AuditKeyError[]
) {
  if (value === undefined) {
    push(errors, variable, undefined, 'missing', 'falta la variable')
    return []
  }
  if (value === '') {
    push(errors, variable, undefined, 'empty', 'está vacía')
    return []
  }

  const parts = value.split(',')
  const entries: ParsedEntry[] = []
  parts.forEach((part, index) => {
    const position = index + 1
    if (part === '') {
      if (index === parts.length - 1)
        push(errors, variable, position, 'trailing_comma', 'coma al final (sobra la última coma)')
      else
        push(
          errors,
          variable,
          position,
          'empty_entry',
          'entrada vacía (dos comas seguidas o coma al principio)'
        )
      return
    }
    if (/\s/.test(part)) {
      push(
        errors,
        variable,
        position,
        'whitespace',
        'contiene espacios u otros caracteres en blanco'
      )
      return
    }
    const pieces = part.split(':')
    if (pieces.length < 2) {
      push(
        errors,
        variable,
        position,
        'missing_separator',
        'falta el ":" entre id y clave (formato id:base64)'
      )
      return
    }
    if (pieces.length > 2) {
      push(errors, variable, position, 'extra_separator', 'tiene más de un ":" (formato id:base64)')
      return
    }

    const [id, encoded] = pieces as [string, string]
    let valid = true
    if (!AUDIT_KEY_ID_PATTERN.test(id)) {
      valid = false
      push(errors, variable, position, 'invalid_id', ID_RULE)
    } else if (options.production && id.startsWith(AUDIT_DEV_KEY_PREFIX)) {
      valid = false
      push(errors, variable, position, 'dev_key_in_production', DEV_RULE)
    }
    const bytes = decodeKey(encoded)
    if (!bytes) {
      valid = false
      push(errors, variable, position, 'invalid_key', KEY_RULE)
    }
    if (valid && bytes) entries.push({ position, id, bytes })
  })

  checkDuplicates(variable, entries, errors)
  return entries
}

function parseActiveKeyId(variable: string, value: string | undefined, errors: AuditKeyError[]) {
  if (value === undefined)
    return void push(errors, variable, undefined, 'missing', 'falta la variable')
  if (value === '') return void push(errors, variable, undefined, 'empty', 'está vacía')
  if (/\s/.test(value))
    return void push(
      errors,
      variable,
      undefined,
      'whitespace',
      'contiene espacios u otros caracteres en blanco'
    )
  if (!AUDIT_KEY_ID_PATTERN.test(value))
    return void push(errors, variable, undefined, 'invalid_id', ID_RULE)
  return value
}

/** Base64 estándar y canónico de exactamente 32 bytes; Buffer.from solo no alcanza: es permisivo. */
function decodeKey(encoded: string): Buffer | undefined {
  if (!KEY_BASE64.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length !== AUDIT_KEY_BYTES || bytes.toString('base64') !== encoded) return undefined
  return bytes
}

function checkDuplicates(variable: string, entries: ParsedEntry[], errors: AuditKeyError[]) {
  entries.forEach((entry, index) => {
    const earlier = entries.slice(0, index)
    const sameId = earlier.find(other => other.id === entry.id)
    if (sameId)
      push(
        errors,
        variable,
        entry.position,
        'duplicate_id',
        `id repetido (ya está en la posición ${sameId.position})`
      )
    const sameKey = earlier.find(other => other.bytes.equals(entry.bytes))
    if (sameKey)
      push(
        errors,
        variable,
        entry.position,
        'duplicate_key',
        `la misma clave ya está en la posición ${sameKey.position}: cada versión necesita una clave propia`
      )
  })
}

/** Una clave sirve para un solo propósito: firmar (HMAC) o cifrar el contexto de red (AES). */
function checkSharedKeys(hmac: ParsedEntry[], network: ParsedEntry[], errors: AuditKeyError[]) {
  for (const entry of network) {
    const same = hmac.find(other => other.bytes.equals(entry.bytes))
    if (same)
      push(
        errors,
        AUDIT_KEY_VARIABLES.network.keys,
        entry.position,
        'shared_key',
        `es la misma clave que ${AUDIT_KEY_VARIABLES.hmac.keys} posición ${same.position}: los llaveros necesitan claves distintas`
      )
  }
}

const ID_RULE =
  'id inválido: solo minúsculas, dígitos y guiones, de 3 a 64 caracteres, empezando con letra o dígito'
const DEV_RULE = `en producción no se admiten claves de desarrollo (id con prefijo "${AUDIT_DEV_KEY_PREFIX}"), ni activas ni viejas`
const KEY_RULE =
  'la clave no es base64 estándar de 32 bytes (44 caracteres terminados en "="; se genera con openssl rand -base64 32)'

function push(
  errors: AuditKeyError[],
  variable: string,
  position: number | undefined,
  code: AuditKeyErrorCode,
  reason: string
) {
  const where = position === undefined ? variable : `${variable}, posición ${position}`
  errors.push({
    variable,
    ...(position === undefined ? {} : { position }),
    code,
    message: `${where}: ${reason}.`,
  })
}
