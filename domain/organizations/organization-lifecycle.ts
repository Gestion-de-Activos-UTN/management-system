import type { PayloadRequest, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { getAgentLifecycleStatus } from '@/domain/agents/agent-state'
import { AdminDomainError } from '@/domain/organizations/admin-actions'
import { assertUserLimit } from '@/domain/organizations/member-admin'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import { enqueueRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'
import { cancelOpenTasks } from '@/domain/tasks/task-actions'
import {
  reactivateOffice,
  retireOfficeAssets,
  revokeOfficeAgents,
} from '@/domain/offices/office-lifecycle'

export type OrganizationDeactivationImpact = {
  offices: number
  members: number
  agents: number
  network_assets: number
  manual_assets: number
  open_tasks: number
}

export type OrganizationReactivationPreview = {
  /** null: no queda ningún OrgAdmin con usuario existente (409 no_admin_available al confirmar). */
  admin: { name: string; email: string } | null
  office: { name: string } | null
}

export type OrganizationStatusImpact =
  | { is_active: true; deactivation: OrganizationDeactivationImpact }
  | { is_active: false; reactivation: OrganizationReactivationPreview }

async function loadOrganization(req: PayloadRequest, organizationId: string) {
  const organization = await req.payload
    .findByID({
      collection: 'organizations',
      id: organizationId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    .catch(() => null)
  if (!organization) {
    throw new AdminDomainError('organization_not_found', 404, 'La organización no existe.')
  }
  return organization
}

async function organizationOffices(req: PayloadRequest, organizationId: string) {
  const found = await req.payload.find({
    collection: 'offices',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    sort: 'createdAt',
  })
  return found.docs
}

const live = (organizationId: string): Where => ({
  and: [
    { organization: { equals: organizationId } },
    { status: { not_equals: 'retired' } },
    { deleted_at: { exists: false } },
  ],
})

async function deactivationImpact(
  req: PayloadRequest,
  organizationId: string
): Promise<OrganizationDeactivationImpact> {
  const organization = { organization: { equals: organizationId } }
  const [offices, members, agents, networkAssets, manualAssets, openTasks] = await Promise.all([
    req.payload.count({
      collection: 'offices',
      where: { and: [organization, { is_active: { equals: true } }] },
      overrideAccess: true,
      req,
    }),
    req.payload.count({
      collection: 'organization-memberships',
      where: { and: [organization, { is_active: { equals: true } }] },
      overrideAccess: true,
      req,
    }),
    req.payload.find({
      collection: 'agents',
      where: organization,
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
    }),
    req.payload.count({
      collection: 'assets',
      where: live(organizationId),
      overrideAccess: true,
      req,
    }),
    req.payload.count({
      collection: 'non-network-assets',
      where: live(organizationId),
      overrideAccess: true,
      req,
    }),
    req.payload.count({
      collection: 'tasks',
      where: { and: [organization, { status: { in: ['pending', 'in_progress'] } }] },
      overrideAccess: true,
      req,
    }),
  ])
  return {
    offices: offices.totalDocs,
    members: members.totalDocs,
    agents: agents.docs.filter(agent => getAgentLifecycleStatus(agent) !== 'revoked').length,
    network_assets: networkAssets.totalDocs,
    manual_assets: manualAssets.totalDocs,
    open_tasks: openTasks.totalDocs,
  }
}

/**
 * OrgAdmin a reactivar: el más antiguo de la organización cuyo usuario todavía existe. Un usuario
 * nunca tiene otra membership (OrganizationMemberships.user es unique), así que no hay que mirar
 * si quedó activo en otro lado.
 */
async function oldestAvailableAdmin(req: PayloadRequest, organizationId: string) {
  const roles = await req.payload.find({
    collection: 'roles',
    where: { and: [{ slug: { equals: 'org_admin' } }, { is_platform_role: { equals: false } }] },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const role = roles.docs[0]
  if (!role) return null
  const memberships = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      and: [{ organization: { equals: organizationId } }, { role: { equals: role.id } }],
    },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    sort: 'createdAt',
  })
  for (const membership of memberships.docs) {
    const user = await req.payload
      .findByID({
        collection: 'users',
        id: relationId(membership.user),
        overrideAccess: true,
        req,
        depth: 0,
      })
      .catch(() => null)
    if (user) return { membership, user, role: { id: String(role.id), slug: 'org_admin' as const } }
  }
  return null
}

export async function organizationStatusImpact(
  req: PayloadRequest,
  organizationId: string
): Promise<OrganizationStatusImpact> {
  const organization = await loadOrganization(req, organizationId)
  if (organization.is_active !== false) {
    return { is_active: true, deactivation: await deactivationImpact(req, organizationId) }
  }
  const [admin, offices] = await Promise.all([
    oldestAvailableAdmin(req, organizationId),
    organizationOffices(req, organizationId),
  ])
  return {
    is_active: false,
    reactivation: {
      admin: admin ? { name: admin.user.name, email: admin.user.email } : null,
      office: offices[0] ? { name: offices[0].name } : null,
    },
  }
}

/**
 * Da de baja toda la organización en un solo paso (la transacción la abre el endpoint). No toca
 * las features del plan: las personas quedan inactivas y nadie entra igual, y así reactivar puede
 * abrir los assessments sin pasar por el plan (se aparta de RF-27 / doc 02 a propósito).
 *
 * Orden: primero la organización (el guard del último org_admin sólo protege organizaciones
 * activas), después todas las escrituras de activos y personas, y al final las tareas.
 */
export async function deactivateOrganization(
  req: PayloadRequest,
  organizationId: string,
  { confirm_name }: { confirm_name: string }
) {
  const organization = await loadOrganization(req, organizationId)
  if (organization.is_active === false) return
  // Sin TEXT_RULES: los nombres de organización no tienen regla de texto y podrían no pasarla.
  if (confirm_name.trim() !== organization.name.trim()) {
    throw new AdminDomainError(
      'confirmation_mismatch',
      400,
      'El nombre escrito no coincide con el de la organización.'
    )
  }

  // AUDIT: this action must emit an AuditLogs entry (organization.deactivate, chain_hash over {organization, offices, members, agents, retired assets, cancelled tasks}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {platform admins, org_admins of this organization}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'organizations',
    id: organization.id,
    data: { is_active: false },
    overrideAccess: true,
    req,
  })

  // Todas las oficinas, también las ya inactivas: las desactivadas antes de este cambio pueden
  // conservar escáneres o activos vigentes.
  const offices = await organizationOffices(req, organizationId)
  for (const office of offices) {
    await revokeOfficeAgents(req, String(office.id), 'organization_deactivated')
    await retireOfficeAssets(req, String(office.id), { includeManual: true })
  }

  const memberships = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }],
    },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  for (const membership of memberships.docs) {
    // AUDIT: this action must emit an AuditLogs entry (membership.deactivate, cascaded from organization.deactivate, chain_hash over {membership, organization}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // Las cascadas de OrganizationMemberships pasan el usuario a inactive, cierran sus sesiones,
    // liberan sus tareas y dejan sus activos sin responsable.
    await req.payload.update({
      collection: 'organization-memberships',
      id: membership.id,
      data: { is_active: false },
      overrideAccess: true,
      req,
    })
  }

  await cancelOpenTasks(req, { organizationId }, 'Organización desactivada.')

  for (const office of offices) {
    if (office.is_active !== false) {
      // AUDIT: this action must emit an AuditLogs entry (office.deactivate, cascaded from organization.deactivate, chain_hash over {office}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await req.payload.update({
        collection: 'offices',
        id: office.id,
        data: { is_active: false },
        overrideAccess: true,
        req,
      })
    }
    await reconcileAssessmentInstance(
      req.payload,
      { scope: 'office', id: String(office.id), organizationId, is_active: false },
      'manual_review',
      req
    )
  }
  await reconcileAssessmentInstance(
    req.payload,
    { scope: 'organization', id: organizationId, organizationId, is_active: false },
    'manual_review',
    req
  )
}

/**
 * Reactiva la organización con lo mínimo para operar: su OrgAdmin más antiguo disponible y su
 * oficina más antigua, y abre los assessments de ambas. No restaura nada más (activos, escáneres,
 * otras personas u oficinas): cada cosa se reactiva aparte.
 */
export async function reactivateOrganization(req: PayloadRequest, organizationId: string) {
  const organization = await loadOrganization(req, organizationId)
  if (organization.is_active !== false) return
  const [admin, offices] = await Promise.all([
    oldestAvailableAdmin(req, organizationId),
    organizationOffices(req, organizationId),
  ])
  if (!admin) {
    throw new AdminDomainError(
      'no_admin_available',
      409,
      'No queda ninguna persona administradora para reactivar la organización.'
    )
  }
  if (!offices[0]) {
    throw new AdminDomainError('no_office_available', 409, 'La organización no tiene oficinas.')
  }

  // AUDIT: this action must emit an AuditLogs entry (organization.reactivate, chain_hash over {organization, admin membership, office}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {the reactivated org_admin}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'organizations',
    id: organization.id,
    data: { is_active: true },
    overrideAccess: true,
    req,
  })
  // Valida el tope de oficinas del plan y abre el assessment de la oficina.
  await reactivateOffice(req, organizationId, String(offices[0].id))

  if (admin.membership.is_active !== true) {
    await assertUserLimit(req, organizationId, admin.role, String(admin.membership.id))
    // AUDIT: this action must emit an AuditLogs entry (membership.reactivate, cascaded from organization.reactivate, chain_hash over {membership}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // enforceOrgAdminOffices le asigna todas las oficinas de la organización.
    await req.payload.update({
      collection: 'organization-memberships',
      id: admin.membership.id,
      data: { is_active: true },
      overrideAccess: true,
      req,
    })
  }
  // La cascada de desactivación pasó al usuario a inactive y a propósito no lo revierte sola.
  await req.payload.update({
    collection: 'users',
    id: admin.user.id,
    data: { status: 'active' },
    overrideAccess: true,
    req,
  })

  await reconcileAssessmentInstance(
    req.payload,
    { scope: 'organization', id: organizationId, organizationId, is_active: true },
    'organization_reactivated',
    req
  )
  await enqueueRiskRecalculation(req.payload, organizationId, [String(offices[0].id)], req)
}
