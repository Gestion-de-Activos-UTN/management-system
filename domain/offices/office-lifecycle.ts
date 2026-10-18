import type { PayloadRequest, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { withSystemContext } from '@/lib/system-context'
import {
  buildRevocationData,
  getAgentLifecycleStatus,
  type AgentRevocationReason,
} from '@/domain/agents/agent-state'
import {
  AdminDomainError,
  assertOrganizationActive,
  subscriptionLimits,
} from '@/domain/organizations/admin-actions'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import { enqueueRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'
import { cancelOpenTasks } from '@/domain/tasks/task-actions'
import { lockAssetRow } from '@/domain/with-transaction'
import type { OfficeDeactivationInput } from '@/modules/offices/schema'

export type OfficeLocation = { province_id?: string | null; department_id?: string | null }
type OfficeDoc = {
  id: string | number
  organization: unknown
  name: string
  is_active?: boolean | null
}

export type AffectedMember = { user_id: string; name: string; email: string; role: string }
export type ImpactedManualAsset = {
  id: string
  name: string
  category: string
  owner_name: string | null
}
export type OfficeDeactivationImpact = {
  /** Agentes no revocados de la oficina: se revocan al desactivarla. */
  agents: number
  /** Personas cuya única oficina activa es esta: se desactivan. */
  members_without_office: AffectedMember[]
  /** Personas que tienen otras oficinas activas: sólo pierden esta. */
  members_losing_office: AffectedMember[]
  /** Activos de red vigentes: se dan de baja (status 'retired'). */
  network_assets: number
  /** Activos manuales vigentes: se mueven a la oficina que se elija, sin responsable ni ubicación. */
  manual_assets: ImpactedManualAsset[]
  /** Tareas abiertas que se cancelan (las de activos manuales se mueven con el activo). */
  open_tasks: number
  /** La oficina tiene un assessment abierto: se cierra. */
  open_assessment: boolean
  /** Oficinas activas a las que se pueden mover los activos manuales. */
  destination_offices: { id: string; name: string }[]
}

async function activeOffices(req: PayloadRequest, organizationId: string) {
  const found = await req.payload.find({
    collection: 'offices',
    where: { and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }] },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs
}

async function activeOfficeIds(req: PayloadRequest, organizationId: string) {
  return (await activeOffices(req, organizationId)).map(office => String(office.id))
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
  // RF-23a: una organización inactiva no suma oficinas.
  await assertOrganizationActive(req, organizationId)
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

// Vigente = no retirado ni borrado: lo único que una desactivación tiene que resolver.
const liveIn = (officeId: string): Where => ({
  and: [
    { office: { equals: officeId } },
    { status: { not_equals: 'retired' } },
    { deleted_at: { exists: false } },
  ],
})

async function liveNetworkAssets(req: PayloadRequest, officeId: string) {
  const found = await req.payload.find({
    collection: 'assets',
    where: liveIn(officeId),
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs
}

async function liveManualAssets(req: PayloadRequest, officeId: string) {
  const found = await req.payload.find({
    collection: 'non-network-assets',
    where: liveIn(officeId),
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
  })
  return found.docs
}

/** Revoca los escáneres de la oficina. Usado al desactivar la oficina o la organización. */
export async function revokeOfficeAgents(
  req: PayloadRequest,
  officeId: string,
  reason: Extract<AgentRevocationReason, 'office_deactivated' | 'organization_deactivated'>
) {
  for (const agent of await officeAgents(req, officeId)) {
    // AUDIT: this action must emit an AuditLogs entry (agent.revoke, reason {office_deactivated|organization_deactivated}, chain_hash over {agent, office, revoked_at}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.update({
      collection: 'agents',
      id: agent.id,
      data: buildRevocationData(reason),
      overrideAccess: true,
      req,
    })
  }
}

/**
 * Da de baja (status 'retired', sin deleted_at: RF-37 permite reactivarlos) los activos vigentes
 * de la oficina. Sólo se escribe `status`: un activo de red no identificado rechaza cualquier
 * campo de negocio. Los hooks de cada activo cancelan sus tareas, cierran sus assessments y
 * encolan el riesgo.
 */
export async function retireOfficeAssets(
  req: PayloadRequest,
  officeId: string,
  { includeManual }: { includeManual: boolean }
) {
  const targets = [
    ...(await liveNetworkAssets(req, officeId)).map(doc => ({
      collection: 'assets' as const,
      id: String(doc.id),
    })),
    ...(includeManual ? await liveManualAssets(req, officeId) : []).map(doc => ({
      collection: 'non-network-assets' as const,
      id: String(doc.id),
    })),
  ]
  // ponytail: uno por uno para que corran los hooks de cada activo; por lotes si llega a medirse lento.
  for (const { collection, id } of targets) {
    await lockAssetRow(req, collection, id)
    // AUDIT: this action must emit an AuditLogs entry (asset.retire, cascaded from office/organization deactivation, chain_hash over {asset, status}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.update({
      collection,
      id,
      data: { status: 'retired' },
      overrideAccess: true,
      req,
    })
  }
}

/**
 * Mueve activos manuales a otra oficina activa. Llegan sin responsable ni ubicación (eran de la
 * oficina anterior); el resto de sus valores se conserva. Los hooks cierran su assessment, abren
 * uno en el destino y mueven sus tareas con requires_reassignment.
 */
async function moveManualAssets(
  req: PayloadRequest,
  moves: { asset_id: string; office_id: string }[]
) {
  await withSystemContext(req, 'systemOwnerRelease', async () => {
    for (const move of moves) {
      await lockAssetRow(req, 'non-network-assets', move.asset_id)
      // AUDIT: this action must emit an AuditLogs entry (asset.move, cascaded from office.deactivate, chain_hash over {asset, previous office, office, owner: null, location: null}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {org_admins and office_managers of the destination office: asset needs an owner}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await req.payload.update({
        collection: 'non-network-assets',
        id: move.asset_id,
        data: { office: move.office_id, owner: null, location: null },
        overrideAccess: true,
        req,
      })
    }
  })
}

/** Tareas abiertas de la oficina, sin las de los activos manuales que se van a mover con ellos. */
async function cancellableTaskCount(req: PayloadRequest, officeId: string, manualIds: string[]) {
  const [tasks, manualAssessments] = await Promise.all([
    req.payload.find({
      collection: 'tasks',
      where: {
        and: [{ office: { equals: officeId } }, { status: { in: ['pending', 'in_progress'] } }],
      },
      overrideAccess: true,
      req,
      depth: 0,
      pagination: false,
      select: { related_entity: true },
    }),
    manualIds.length
      ? req.payload.find({
          collection: 'assessment-instances',
          where: { manual_asset: { in: manualIds } },
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
          select: {},
        })
      : { docs: [] },
  ])
  const moving = new Set([...manualIds, ...manualAssessments.docs.map(doc => String(doc.id))])
  return tasks.docs.filter(
    task => !task.related_entity || !moving.has(relationId(task.related_entity.value))
  ).length
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
  const [agents, memberships, offices, networkAssets, manualAssets, openAssessment] =
    await Promise.all([
      officeAgents(req, officeId),
      officeMemberships(req, organizationId, officeId),
      activeOffices(req, organizationId),
      liveNetworkAssets(req, officeId),
      liveManualAssets(req, officeId),
      req.payload.count({
        collection: 'assessment-instances',
        where: {
          and: [
            { scope: { equals: 'office' } },
            { office: { equals: officeId } },
            { status: { in: ['pending', 'in_progress'] } },
          ],
        },
        overrideAccess: true,
        req,
      }),
    ])
  const destinations = offices.filter(candidate => String(candidate.id) !== officeId)
  const remainingActive = new Set(destinations.map(candidate => String(candidate.id)))
  const affected = memberships
    .filter(m => m.role !== 'org_admin')
    .map(m => ({
      member: {
        user_id: relationId(m.user),
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      },
      keepsAnOffice: m.offices.some(id => remainingActive.has(id)),
    }))
  const ownerIds = [
    ...new Set(manualAssets.flatMap(asset => (asset.owner ? [relationId(asset.owner)] : []))),
  ]
  const owners = ownerIds.length
    ? await req.payload.find({
        collection: 'users',
        where: { id: { in: ownerIds } },
        overrideAccess: true,
        req,
        depth: 0,
        pagination: false,
        select: { name: true },
      })
    : { docs: [] }
  const ownerName = new Map(owners.docs.map(user => [String(user.id), user.name]))
  const manualIds = manualAssets.map(asset => String(asset.id))
  return {
    agents: agents.length,
    members_without_office: affected.filter(a => !a.keepsAnOffice).map(a => a.member),
    members_losing_office: affected.filter(a => a.keepsAnOffice).map(a => a.member),
    network_assets: networkAssets.length,
    manual_assets: manualAssets.map(asset => ({
      id: String(asset.id),
      name: asset.alias,
      category: asset.asset_category,
      owner_name: asset.owner ? (ownerName.get(relationId(asset.owner)) ?? null) : null,
    })),
    open_tasks: await cancellableTaskCount(req, officeId, manualIds),
    open_assessment: openAssessment.totalDocs > 0,
    destination_offices: destinations.map(candidate => ({
      id: String(candidate.id),
      name: candidate.name,
    })),
  }
}

/**
 * Desactiva la oficina en un solo paso (la transacción la abre el endpoint): mueve los activos
 * manuales, da de baja los de red, revoca los escáneres, saca la oficina a las personas (y
 * desactiva a quienes se quedan sin ninguna), cancela las tareas que quedan y cierra su
 * assessment. Reactivar no restaura nada de esto.
 *
 * Orden: todas las escrituras de activos antes que las de tareas, igual que la ingesta y el PATCH
 * de un activo (fila del activo, después lock de la tarea), para no cruzar locks.
 */
export async function deactivateOffice(
  req: PayloadRequest,
  organizationId: string,
  officeId: string,
  input: Omit<OfficeDeactivationInput, 'is_active'>
) {
  // Se relee dentro de la transacción: lo que se cargó antes de abrirla puede estar viejo.
  const office = await loadOrganizationOffice(req, organizationId, officeId)
  if (office.is_active === false) return
  const activeIds = await activeOfficeIds(req, organizationId)
  if (activeIds.length <= 1 && activeIds.includes(officeId)) {
    throw new AdminDomainError(
      'last_active_office',
      409,
      'La organización debe conservar al menos una oficina activa.'
    )
  }
  if (input.confirm_name.trim() !== office.name.trim()) {
    throw new AdminDomainError(
      'confirmation_mismatch',
      400,
      'El nombre escrito no coincide con el de la oficina.'
    )
  }

  // Cada activo manual vigente necesita exactamente un destino activo, distinto de esta oficina.
  const manualIds = new Set((await liveManualAssets(req, officeId)).map(doc => String(doc.id)))
  const movedIds = input.manual_asset_moves.map(move => move.asset_id)
  if (
    movedIds.length !== manualIds.size ||
    new Set(movedIds).size !== movedIds.length ||
    movedIds.some(id => !manualIds.has(id))
  ) {
    throw new AdminDomainError(
      'impact_changed',
      409,
      'Los activos de la oficina cambiaron. Revisa el impacto otra vez antes de confirmar.'
    )
  }
  const destinations = new Set(activeIds.filter(id => id !== officeId))
  if (input.manual_asset_moves.some(move => !destinations.has(move.office_id))) {
    throw new AdminDomainError(
      'invalid_destination',
      400,
      'Cada activo tiene que ir a otra oficina activa de la organización.'
    )
  }

  await moveManualAssets(req, input.manual_asset_moves)
  await retireOfficeAssets(req, officeId, { includeManual: false })
  await revokeOfficeAgents(req, officeId, 'office_deactivated')

  const remainingActive = new Set(destinations)
  for (const membership of await officeMemberships(req, organizationId, officeId)) {
    if (membership.role === 'org_admin') continue // cubren todas las oficinas, activas o no
    if (!membership.offices.some(id => remainingActive.has(id))) {
      // AUDIT: this action must emit an AuditLogs entry (membership.deactivate, cascaded from office.deactivate, chain_hash over {membership, office}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {the deactivated user, org_admins of this organization}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      // Las cascadas de OrganizationMemberships pasan el usuario a inactive, cierran sus sesiones,
      // liberan sus tareas en curso y dejan sus activos sin responsable.
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

  // Las tareas de los activos movidos ya cambiaron de oficina: quedan sólo las de esta.
  await cancelOpenTasks(req, { organizationId, officeId }, 'Oficina desactivada.')

  // AUDIT: this action must emit an AuditLogs entry (office.deactivate, chain_hash over {office, moved assets, retired assets, revoked agents, deactivated members, cancelled tasks}, previous hash for this organization_id)
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
  await reconcileAssessmentInstance(
    req.payload,
    { scope: 'office', id: officeId, organizationId, is_active: false },
    'manual_review',
    req
  )
  // La organización deja de contar esta oficina (domain/risk/recalculateRisk.ts).
  await enqueueRiskRecalculation(req.payload, organizationId, [], req)
}

/**
 * Reactiva la oficina y abre su assessment (lo ven los org_admin, que la cubren siempre). No
 * restaura escáneres, personas ni activos movidos o dados de baja: eso es una decisión aparte.
 */
export async function reactivateOffice(
  req: PayloadRequest,
  organizationId: string,
  officeId: string
) {
  const office = await loadOrganizationOffice(req, organizationId, officeId)
  if (office.is_active !== false) return
  await assertOrganizationActive(req, organizationId)
  await assertOfficeQuota(req, organizationId)
  // AUDIT: this action must emit an AuditLogs entry (office.reactivate, chain_hash over {office}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {org_admins of this organization}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'offices',
    id: office.id,
    data: { is_active: true },
    overrideAccess: true,
    req,
  })
  await reconcileAssessmentInstance(
    req.payload,
    { scope: 'office', id: officeId, organizationId, is_active: true },
    'office_reactivated',
    req
  )
  await enqueueRiskRecalculation(req.payload, organizationId, [officeId], req)
}
