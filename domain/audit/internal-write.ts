import type { RequestContext } from 'payload'

// Marca interna que autoriza crear filas en AuditLogs y AuditNetworkContexts
// (documentation/planes/audit-log/03-seguridad-y-claves.md §2: "contexto interno no
// falsificable a través de REST"; no un `context.audit: true` que podría mandar un cliente).
//
// - La clave es un Symbol: ningún JSON (REST, GraphQL, formularios) puede traerla.
// - El valor es un token de un solo uso. Payload asigna el `context` de cada operación sobre el
//   `req` compartido (createLocalReq: `req.context = {...req.context, ...context}`), así que la
//   marca quedaría pegada al req para las operaciones siguientes: el guard la consume y la borra
//   del contexto, y quien la emitió la revoca en un `finally` por si el guard nunca corrió.
//
// Solo la usa el cierre transaccional (domain/audit/chain.ts, F1b paso 4b) y los tests.

const AUDIT_INTERNAL_WRITE = Symbol('siam.audit.internal-write')
const pending = new Set<symbol>()

type MarkedContext = RequestContext & { [AUDIT_INTERNAL_WRITE]?: unknown }

/** Contexto para un único create interno. Revocarlo con revokeInternalAuditWrite al terminar. */
export function internalAuditWriteContext(): RequestContext {
  const token = Symbol('siam.audit.write-token')
  pending.add(token)
  return { [AUDIT_INTERNAL_WRITE]: token } as MarkedContext
}

/** Invalida el token si quedó sin usar (por ejemplo, si el create falló antes del guard). */
export function revokeInternalAuditWrite(context: RequestContext) {
  const token = (context as MarkedContext)[AUDIT_INTERNAL_WRITE]
  if (typeof token === 'symbol') pending.delete(token)
}

/**
 * Para el guard de la colección: true solo si el contexto trae un token vigente. Lo consume
 * (no sirve dos veces) y lo saca del contexto, que puede ser el del req compartido.
 */
export function consumeInternalAuditWrite(context: RequestContext | undefined): boolean {
  if (!context) return false
  const marked = context as MarkedContext
  const token = marked[AUDIT_INTERNAL_WRITE]
  delete marked[AUDIT_INTERNAL_WRITE]
  if (typeof token !== 'symbol' || !pending.has(token)) return false
  pending.delete(token)
  return true
}

/** Solo para tests: cuántos tokens siguen vigentes (detecta tokens que nadie revocó). */
export function pendingInternalAuditWrites(): number {
  return pending.size
}
