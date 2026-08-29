import { APIError } from 'payload'

// Invariantes puros de NonNetworkAssets — sin req, sin DB: solo reglas.
// Mismo criterio que collections/OrganizationMemberships/invariants.ts (testeables en aislamiento,
// los hooks solo hacen I/O y delegan la decisión acá).
//
// A diferencia de aquel, los errores extienden APIError en vez de Error: un `throw new Error` en un
// hook sale como 500 "Something went wrong" (verificado), que para un rechazo de autorización es
// status equivocado y mensaje inútil. APIError lleva el status y, con isPublic, deja pasar el texto.
export class OfficeOutOfScopeError extends APIError {
  constructor(message: string) {
    super(message, 403, undefined, true)
  }
}

export class MissingOfficeError extends APIError {
  constructor(message: string) {
    super(message, 400, undefined, true)
  }
}

export function assertOfficeInScope(
  officeId: string | null,
  allowedOfficeIds: string[],
  unrestricted: boolean
): void {
  if (!officeId) {
    throw new MissingOfficeError(
      'NonNetworkAssets.office es obligatorio: identifica el tenant del activo'
    )
  }
  // platform_admin sin ?asOrganization= no tiene officeIds resueltos (ve todo) — el scoping de
  // fila no aplica, pero `organization` se sigue derivando de la office elegida.
  if (unrestricted) return
  if (!allowedOfficeIds.includes(officeId)) {
    throw new OfficeOutOfScopeError(
      'La oficina indicada no pertenece a las oficinas asignadas al usuario'
    )
  }
}

export type ReviewInterval = 'never' | '1d' | '3d' | '1w' | '1m' | '6m' | '1y'

// Horas, no días: 1d/3d necesitan precisión de horas para expresar la ventana de habilitación
// de 12hs (ver EARLY_WINDOW_HOURS) sin perderla redondeando a un entero de días.
const INTERVAL_HOURS: Record<Exclude<ReviewInterval, 'never'>, number> = {
  '1d': 24,
  '3d': 72,
  '1w': 24 * 7,
  '1m': 24 * 30,
  '6m': 24 * 182,
  '1y': 24 * 365,
}

// `next_review_at` siempre se deriva de `review_interval` — no hay más override manual de fecha
// (ver collections/NonNetworkAssets/hooks/resolveTenant.ts).
export function computeNextReviewAt(interval: ReviewInterval, now: Date): string | null {
  if (interval === 'never') return null
  const next = new Date(now.getTime())
  next.setUTCHours(next.getUTCHours() + INTERVAL_HOURS[interval])
  return next.toISOString()
}

// Cuántas horas antes del vencimiento se habilita el botón "Mark reviewed" — tabla fija acordada
// con el usuario (intervalos cortos abren su ventana el mismo día, los largos con más antelación).
const EARLY_WINDOW_HOURS: Record<Exclude<ReviewInterval, 'never'>, number> = {
  '1d': 12,
  '3d': 12,
  '1w': 24,
  '1m': 24 * 5,
  '6m': 24 * 10,
  '1y': 24 * 10,
}

// 'never' no tiene nada que revisar. Vencido siempre habilita (la intención de la ventana
// anticipada es evitar LLEGAR a vencido, no bloquear la renovación de algo ya vencido).
export function canReviewNow(
  nextReviewAt: string | null,
  interval: ReviewInterval,
  now: Date
): boolean {
  if (interval === 'never' || !nextReviewAt) return false
  const dueAt = new Date(nextReviewAt).getTime()
  if (dueAt < now.getTime()) return true
  const windowStart = dueAt - EARLY_WINDOW_HOURS[interval] * 60 * 60 * 1000
  return now.getTime() >= windowStart
}

export type ReviewStatus = 'ok' | 'overdue'

// Virtual, no persistido — mismo patrón que Agents.status (afterRead, comparación de fecha).
// Sin `next_review_at` (política no configurada y usuario no cargó fecha) no hay nada que
// esté "vencido" todavía — 'ok' es el default seguro, no 'overdue'.
export function computeReviewStatus(nextReviewAt: string | null, now: Date): ReviewStatus {
  if (!nextReviewAt) return 'ok'
  return new Date(nextReviewAt).getTime() < now.getTime() ? 'overdue' : 'ok'
}
