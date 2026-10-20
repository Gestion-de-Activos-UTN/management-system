import type { PayloadRequest } from 'payload'

// Marcadores en req.context que sólo pone código del servidor: el input HTTP no llega a
// req.context (mismo criterio que `reviewConfirmed`/`seedEffectiveNow`).
// systemOwnerRelease: el sistema deja un activo sin responsable (persona desactivada, activo
// movido de una oficina desactivada). Una persona nunca puede elegir "Sin responsable".
export type SystemContextKey = 'systemOwnerRelease'

/** Activa el marcador sólo mientras corre `fn`, para no contaminar el resto del request. */
export async function withSystemContext<T>(
  req: PayloadRequest,
  key: SystemContextKey,
  fn: () => Promise<T>
): Promise<T> {
  const previous = req.context[key]
  req.context[key] = true
  try {
    return await fn()
  } finally {
    req.context[key] = previous
  }
}
