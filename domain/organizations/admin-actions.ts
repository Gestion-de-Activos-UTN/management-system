import { APIError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
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
  // Reglas de los hooks de activos que corren en cascada (p. ej. el reemplazo de responsable no
  // cubre la oficina de un activo): su mensaje ya es público y explica qué corregir.
  if (error instanceof APIError && error.isPublic)
    return json({ error: 'invalid_request', message: error.message }, error.status)
  throw error
}

/** Una organización inactiva no reactiva ni suma nada: sólo un PlatformAdmin la reactiva. */
export async function assertOrganizationActive(req: PayloadRequest, organizationId: string) {
  const organization = await req.payload.findByID({
    collection: 'organizations',
    id: organizationId,
    overrideAccess: true,
    req,
    depth: 0,
  })
  if (organization.is_active === false) {
    throw new AdminDomainError(
      'organization_inactive',
      409,
      'La organización está inactiva. Sólo un administrador de la plataforma puede reactivarla.'
    )
  }
}

/** Custom write endpoints use this without restricting historical GETs or active tenants. */
export async function organizationWriteError(req: PayloadRequest, organizationId: string) {
  try {
    await assertOrganizationActive(req, organizationId)
    return null
  } catch (error) {
    return adminErrorResponse(error)
  }
}

/**
 * beforeChange compartido por Assets y NonNetworkAssets: ninguna escritura de un usuario (ni de
 * un PlatformAdmin que visita) toca una organización inactiva, llegue por REST o por un endpoint
 * propio. No aplica sin usuario (ingesta del escáner, jobs) ni sin organización visitada
 * (cascadas del StaffPortal, que tienen que poder retirar activos al desactivar).
 */
export const rejectWritesInInactiveOrganization: CollectionBeforeChangeHook = async ({
  data,
  req,
}) => {
  const ctx = await getTenantContext(req)
  if (!ctx?.organizationId) return data
  try {
    await assertOrganizationActive(req, ctx.organizationId)
  } catch (error) {
    if (error instanceof AdminDomainError)
      throw new APIError(error.message, error.status, { code: error.code }, true)
    throw error
  }
  return data
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
