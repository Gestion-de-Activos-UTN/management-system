import { canonicalJson } from '@/lib/canonical-json'

// JSON canónico de lo que firma el AuditLog (sobre del evento y contexto de red). Reutiliza
// lib/canonical-json.ts, que no se toca: de él dependen fingerprints ya guardados. Aquel
// convierte en silencio valores que no son JSON (undefined → texto "undefined", NaN → null,
// Date → {}); acá se rechazan antes, porque una firma sobre un valor alterado no prueba nada
// (documentation/planes/audit-log/03-seguridad-y-claves.md §3).
// También se rechazan textos que PostgreSQL jsonb no acepta (NUL y surrogates sueltos): si no,
// la firma se calcularía bien y el INSERT fallaría después.
// El error indica dónde está el valor, nunca el valor: puede ser un dato sensible.

/** Niveles de objetos/arrays anidados admitidos (el objeto raíz es el nivel 1). */
export const AUDIT_JSON_MAX_DEPTH = 32

export class AuditCanonicalError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string
  ) {
    super(`Valor no admitido para el AuditLog en ${path}: ${reason}.`)
    this.name = 'AuditCanonicalError'
  }
}

/**
 * Texto canónico de un valor JSON estricto: claves ordenadas por unidad UTF-16 en todos los
 * niveles, arrays en su orden. Lanza AuditCanonicalError si el valor no es JSON representable
 * sin pérdida. `-0` se acepta y queda como `0`, igual que lo devuelve jsonb.
 */
export function auditCanonicalJson(value: unknown): string {
  assertAuditJson(value, '$', 1, new Set())
  return canonicalJson(value)
}

function assertAuditJson(value: unknown, path: string, level: number, ancestors: Set<object>) {
  switch (typeof value) {
    case 'string':
      assertStorableText(value, path, 'el texto')
      return
    case 'boolean':
      return
    case 'number':
      if (!Number.isFinite(value)) fail(path, 'número no finito (NaN o Infinity)')
      return
    case 'undefined':
      return fail(path, 'undefined (usar null o quitar la clave)')
    case 'bigint':
      return fail(path, 'bigint (no existe en JSON)')
    case 'symbol':
    case 'function':
      return fail(path, `${typeof value} (no existe en JSON)`)
  }
  if (value === null) return

  const node = value as object
  if (level > AUDIT_JSON_MAX_DEPTH) fail(path, `más de ${AUDIT_JSON_MAX_DEPTH} niveles anidados`)
  if (ancestors.has(node)) fail(path, 'referencia circular')
  ancestors.add(node)

  if (Array.isArray(node)) {
    if (Object.getPrototypeOf(node) !== Array.prototype) fail(path, 'array de una subclase')
    for (let index = 0; index < node.length; index++) {
      if (!(index in node)) fail(`${path}[${index}]`, 'hueco en el array')
      assertAuditJson(node[index], `${path}[${index}]`, level + 1, ancestors)
    }
    // Propiedades que no son índices: canonicalJson las descartaría sin avisar.
    if (Object.keys(node).length !== node.length) fail(path, 'array con propiedades extra')
  } else {
    const proto = Object.getPrototypeOf(node)
    if (proto !== Object.prototype && proto !== null)
      fail(path, `objeto no plano (${node.constructor?.name || 'sin constructor'})`)
    if (Object.getOwnPropertySymbols(node).length > 0) fail(path, 'clave de tipo symbol')
    for (const [key, item] of Object.entries(node)) {
      const child = childPath(path, key)
      if (key === '__proto__') fail(child, 'clave reservada __proto__')
      assertStorableText(key, child, 'la clave')
      assertAuditJson(item, child, level + 1, ancestors)
    }
  }

  ancestors.delete(node)
}

function assertStorableText(text: string, path: string, what: string) {
  if (text.includes('\u0000')) fail(path, `${what} contiene el carácter NUL, que jsonb no admite`)
  if (!text.isWellFormed()) fail(path, `${what} tiene Unicode mal formado (surrogate suelto)`)
}

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/

/** `$.a.b`, o `$["otra clave"]` si no es un identificador; claves largas recortadas. */
function childPath(path: string, key: string) {
  if (PLAIN_KEY.test(key) && key.length <= 64) return `${path}.${key}`
  const shown = key.length > 64 ? `${key.slice(0, 64)}…` : key
  return `${path}[${JSON.stringify(shown.isWellFormed() ? shown : shown.toWellFormed())}]`
}

function fail(path: string, reason: string): never {
  throw new AuditCanonicalError(path, reason)
}
