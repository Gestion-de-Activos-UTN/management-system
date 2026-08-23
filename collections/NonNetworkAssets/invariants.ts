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

// Política de revisión a nivel organización (OrganizationSettings.review_policy, json libre).
// `by_category` gana sobre `default_days`; ambos opcionales — sin política, no hay default y
// la fecha queda en manos del usuario (override por-asset).
export interface ReviewPolicy {
  default_days?: number
  by_category?: Record<string, number>
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

export function resolveReviewIntervalDays(
  policy: ReviewPolicy | null,
  category: string | null
): number | null {
  if (!policy) return null
  const byCategory = category ? policy.by_category?.[category] : undefined
  if (typeof byCategory === 'number' && byCategory > 0) return byCategory
  if (typeof policy.default_days === 'number' && policy.default_days > 0) return policy.default_days
  return null
}

// Default derivado de la política de la organización. Solo se usa cuando el usuario NO mandó
// `next_review_at` — el override por-asset siempre gana (decisión: política como default, no como techo).
export function computeNextReviewAt(
  policy: ReviewPolicy | null,
  category: string | null,
  now: Date
): string | null {
  const days = resolveReviewIntervalDays(policy, category)
  if (days === null) return null
  const next = new Date(now.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString()
}

export type ReviewStatus = 'ok' | 'overdue'

// Virtual, no persistido — mismo patrón que Agents.status (afterRead, comparación de fecha).
// Sin `next_review_at` (política no configurada y usuario no cargó fecha) no hay nada que
// esté "vencido" todavía — 'ok' es el default seguro, no 'overdue'.
export function computeReviewStatus(nextReviewAt: string | null, now: Date): ReviewStatus {
  if (!nextReviewAt) return 'ok'
  return new Date(nextReviewAt).getTime() < now.getTime() ? 'overdue' : 'ok'
}
