import type { PayloadRequest } from 'payload'
import { planLimits } from '@/domain/subscriptions/plan-limits'
import type { OrganizationRoleSlug } from '@/modules/users/schema'
import {
  LastActiveOrgAdminError,
  RankEscalationError,
} from '@/collections/OrganizationMemberships/invariants'

// Errores de negocio de la administración de la organización (oficinas, miembros, perfil).
// `details` viaja al cliente cuando la UI necesita mostrar el impacto (p. ej. quiénes quedarían
// sin oficina) antes de pedir confirmación.
export class AdminDomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    message = code,
    public readonly details?: unknown
  ) {
    super(message)
  }
}

export function adminErrorResponse(error: unknown): Response {
  const json = (body: unknown, status: number) => Response.json(body, { status })
  if (error instanceof AdminDomainError) {
    return json({ error: error.code, message: error.message, details: error.details }, error.status)
  }
  // Invariantes de los hooks de OrganizationMemberships: llegan como errores propios.
  if (error instanceof RankEscalationError)
    return json({ error: 'rank_escalation', message: error.message }, 403)
  if (error instanceof LastActiveOrgAdminError)
    return json({ error: 'last_active_org_admin', message: error.message }, 409)
  throw error
}

/**
 * Lock por organización para las acciones de Administración: serializa altas, bajas y cambios
 * de rol concurrentes, que de otro modo podrían saltear el tope del plan o dejar a la
 * organización sin org_admin (ambos chequeos leen y después escriben).
 */
export const organizationAdminLock = (organizationId: string) => `org-admin:${organizationId}`

/** Límites del plan de la organización; null = sin tope cargado. */
export async function subscriptionLimits(req: PayloadRequest, organizationId: string) {
  const found = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const limits = planLimits(found.docs[0])
  return {
    maxOffices: limits.max_offices,
    userLimit: (role: string) => limits.user_limits[role as OrganizationRoleSlug] ?? null,
  }
}
