import type { PayloadRequest } from 'payload'
import { relationId } from '@/lib/relationId'
import { buildRevocationData, getAgentLifecycleStatus } from '@/domain/agents/agent-state'
import { AdminDomainError, subscriptionLimits } from '@/domain/organizations/admin-actions'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'

export type OfficeLocation = { province_id?: string | null; department_id?: string | null }
type OfficeDoc = {
  id: string | number
  organization: unknown
  name: string
  is_active?: boolean | null
}

export type AffectedMember = { user_id: string; name: string; email: string; role: string }
export type OfficeDeactivationImpact = {
  /** Agentes no revocados de la oficina: se revocan al desactivarla. */
  agents: number
  /** Personas cuya única oficina activa es esta: se desactivan si se confirma. */
  members_without_office: AffectedMember[]
}

async function activeOfficeIds(req: PayloadRequest, organizationId: string) {
  const found = await req.payload.find({
    collection: 'offices',
    where: { and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }] },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs.map(office => String(office.id))
}

async function assertOfficeQuota(req: PayloadRequest, organizationId: string) {
  const { maxOffices } = await subscriptionLimits(req, organizationId)
  if (maxOffices === null) return
  if ((await activeOfficeIds(req, organizationId)).length >= maxOffices) {
    throw new AdminDomainError(
      'office_limit_reached',
      409,
      `Tu plan permite hasta ${maxOffices} ${maxOffices === 1 ? 'oficina activa' : 'oficinas activas'}.`
    )
  }
}

export async function loadOrganizationOffice(
  req: PayloadRequest,
  organizationId: string,
  officeId: string
): Promise<OfficeDoc> {
  const office = await req.payload
    .findByID({ collection: 'offices', id: officeId, overrideAccess: true, req, depth: 0 })
    .catch(() => null)
  if (!office || relationId(office.organization) !== organizationId) {
    throw new AdminDomainError('office_not_found', 404, 'La oficina no existe.')
  }
  return office as unknown as OfficeDoc
}

export async function createOffice(
  req: PayloadRequest,
  organizationId: string,
  input: { name: string } & OfficeLocation
) {
  await assertOfficeQuota(req, organizationId)
  // AUDIT: this action must emit an AuditLogs entry (office.create, chain_hash over {office, name, location}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // El hook afterChange de Offices (syncOrgAdminMemberships) la asigna a todos los org_admin.
  const office = await req.payload.create({
    collection: 'offices',
    data: { organization: organizationId, is_active: true, ...input },
    overrideAccess: true,
    req,
    depth: 0,
  })
  await reconcileAssessmentInstance(
    req.payload,
    {
      scope: 'office',
      id: String(office.id),
      organizationId,
      is_active: true,
    },
    'initial',
    req
  )
  return office
}

export async function updateOfficeDetails(
  req: PayloadRequest,
  office: OfficeDoc,
  input: { name: string } & OfficeLocation
) {
  // AUDIT: this action must emit an AuditLogs entry (office.update, chain_hash over {office, name, location}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  return req.payload.update({
    collection: 'offices',
    id: office.id,
    data: input,
    overrideAccess: true,
    req,
    depth: 0,
  })
}

async function officeMemberships(req: PayloadRequest, organizationId: string, officeId: string) {
  const found = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { offices: { in: [officeId] } },
        { is_active: { equals: true } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 1,
    pagination: false,
  })
  return found.docs.map(membership => {
    const role = membership.role as unknown as { slug: string }
    const user = membership.user as unknown as { id: string; name: string; email: string }
    return {
      id: String(membership.id),
      role: role.slug,
      user,
      offices: (membership.offices ?? []).map(relationId),
    }
  })
}

async function officeAgents(req: PayloadRequest, officeId: string) {
  const found = await req.payload.find({
    collection: 'agents',
    where: { office: { equals: officeId } },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs.filter(agent => getAgentLifecycleStatus(agent) !== 'revoked')
}

/**
 * Qué pasa si se desactiva la oficina. Los org_admin cubren siempre todas las oficinas, así que
 * nunca quedan sin oficina; el resto queda sin ninguna si esta era su única oficina activa.
 */
export async function officeDeactivationImpact(
  req: PayloadRequest,
  organizationId: string,
  office: OfficeDoc
): Promise<OfficeDeactivationImpact> {
  const officeId = String(office.id)
  const [agents, memberships, activeIds] = await Promise.all([
    officeAgents(req, officeId),
    officeMemberships(req, organizationId, officeId),
    activeOfficeIds(req, organizationId),
  ])
  const remainingActive = new Set(activeIds.filter(id => id !== officeId))
  return {
    agents: agents.length,
    members_without_office: memberships
      .filter(m => m.role !== 'org_admin' && !m.offices.some(id => remainingActive.has(id)))
      .map(m => ({
        user_id: relationId(m.user),
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      })),
  }
}

/**
 * Desactiva la oficina: revoca sus agentes, la quita de las personas que la tenían asignada y
 * desactiva a quienes se quedan sin ninguna oficina activa (requiere `confirmMemberDeactivation`).
 * No se borra nada: activos, escaneos, tareas e historial de riesgo siguen apuntando a ella.
 */
export async function deactivateOffice(
  req: PayloadRequest,
  organizationId: string,
  office: OfficeDoc,
  { confirmMemberDeactivation = false } = {}
) {
  if (office.is_active === false) return
  const officeId = String(office.id)
  const activeIds = await activeOfficeIds(req, organizationId)
  if (activeIds.length <= 1 && activeIds.includes(officeId)) {
    throw new AdminDomainError(
      'last_active_office',
      409,
      'La organización debe conservar al menos una oficina activa.'
    )
  }
  const impact = await officeDeactivationImpact(req, organizationId, office)
  if (impact.members_without_office.length && !confirmMemberDeactivation) {
    throw new AdminDomainError(
      'members_would_be_deactivated',
      409,
      'Hay personas que quedarían sin ninguna oficina asignada.',
      impact
    )
  }

  for (const agent of await officeAgents(req, officeId)) {
    // AUDIT: this action must emit an AuditLogs entry (agent.revoke, reason office_deactivated, chain_hash over {agent, office, revoked_at}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.update({
      collection: 'agents',
      id: agent.id,
      data: buildRevocationData('office_deactivated'),
      overrideAccess: true,
      req,
    })
  }

  const withoutOffice = new Set(impact.members_without_office.map(member => member.user_id))
  for (const membership of await officeMemberships(req, organizationId, officeId)) {
    if (membership.role === 'org_admin') continue // cubren todas las oficinas, activas o no
    if (withoutOffice.has(relationId(membership.user))) {
      // AUDIT: this action must emit an AuditLogs entry (membership.deactivate, cascaded from office.deactivate, chain_hash over {membership, office}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {the deactivated user, org_admins of this organization}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      // La cascada de OrganizationMemberships pasa el usuario a inactive y cierra sus sesiones.
      await req.payload.update({
        collection: 'organization-memberships',
        id: membership.id,
        data: { is_active: false },
        overrideAccess: true,
        req,
      })
    } else {
      // AUDIT: this action must emit an AuditLogs entry (membership.offices, cascaded from office.deactivate, chain_hash over {membership, offices}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await req.payload.update({
        collection: 'organization-memberships',
        id: membership.id,
        data: { offices: membership.offices.filter(id => id !== officeId) },
        overrideAccess: true,
        req,
      })
    }
  }

  // AUDIT: this action must emit an AuditLogs entry (office.deactivate, chain_hash over {office, revoked agents, deactivated members}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {org_admins of this organization}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'offices',
    id: office.id,
    data: { is_active: false },
    overrideAccess: true,
    req,
  })
}

/** Reactiva la oficina. No reactiva en cascada agentes ni personas: eso es una decisión aparte. */
export async function reactivateOffice(
  req: PayloadRequest,
  organizationId: string,
  office: OfficeDoc
) {
  if (office.is_active !== false) return
  await assertOfficeQuota(req, organizationId)
  // AUDIT: this action must emit an AuditLogs entry (office.reactivate, chain_hash over {office}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await req.payload.update({
    collection: 'offices',
    id: office.id,
    data: { is_active: true },
    overrideAccess: true,
    req,
  })
}
