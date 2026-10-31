import { actorRelation, actorMatches } from '@/lib/actor-relation'
import { withTaskLock } from './with-task-lock'
import { withTransaction, lockAssetRow } from '@/domain/with-transaction'
import crypto from 'crypto'
import type { PayloadRequest } from 'payload'
import type { Task } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope, type Action } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import type {
  CreateTasksInput,
  EditTaskInput,
  ReassignTaskInput,
  TaskReferenceInput,
} from '@/modules/tasks/schema'
import {
  assertTaskAssignmentHasEligibleMember,
  assignmentEligibleMembers,
  listEligibleTaskMembers,
} from './task-eligibility'
import { TaskDomainError } from './task-error'
import {
  resolveTaskReference,
  tenantCanReadTaskReference,
  type ResolvedTaskReference,
} from './task-reference'
import { effectiveTaskStatus } from './task-state'

function assertAction(ctx: TenantContext, action: Action): void {
  if (!ctx.organizationId || !ctx.role || !canDo(ctx.role, 'tasks', action, ctx.organizationId)) {
    throw new TaskDomainError('forbidden', 403, 'No tienes permiso para realizar esta acción.')
  }
}

function assertTaskScope(ctx: TenantContext, task: Task): void {
  const organizationId = relationId(task.organization)
  if (!ctx.organizationId || organizationId !== ctx.organizationId) {
    throw new TaskDomainError('task_not_found', 404, 'La tarea no existe.')
  }
  const officeId = task.office ? relationId(task.office) : null
  if (!hasOrgWideScope(ctx.role) && officeId && !ctx.officeIds.includes(officeId)) {
    throw new TaskDomainError('task_not_found', 404, 'La tarea no existe.')
  }
}

export async function loadTask(req: PayloadRequest, id: string): Promise<Task> {
  const task = await req.payload
    .findByID({ collection: 'tasks', id, overrideAccess: true, req, depth: 0 })
    .catch(() => null)
  if (!task) throw new TaskDomainError('task_not_found', 404, 'La tarea no existe.')
  return task
}

function storedReference(task: Task): TaskReferenceInput | undefined {
  if (!task.related_entity) return undefined
  return {
    relationTo: task.related_entity.relationTo,
    value: relationId(task.related_entity.value),
  }
}

export async function resolveStoredTaskReference(
  req: PayloadRequest,
  task: Task
): Promise<ResolvedTaskReference | undefined> {
  const reference = storedReference(task)
  if (!reference) return undefined
  try {
    return await resolveTaskReference(req, reference)
  } catch (error) {
    if (error instanceof TaskDomainError && error.code === 'related_entity_not_found')
      return undefined
    throw error
  }
}

async function assertReferenceReadable(
  req: PayloadRequest,
  ctx: TenantContext,
  task: Task
): Promise<ResolvedTaskReference | undefined> {
  const stored = storedReference(task)
  const resolved = await resolveStoredTaskReference(req, task)
  if (stored && resolved && !tenantCanReadTaskReference(ctx, resolved)) {
    if (task.status === 'completed' || task.status === 'cancelled') return undefined
    throw new TaskDomainError('task_not_found', 404, 'La tarea no existe.')
  }
  return resolved
}

export async function actorIsEligible(
  req: PayloadRequest,
  ctx: TenantContext,
  task: Task,
  reference?: ResolvedTaskReference
): Promise<boolean> {
  if (!ctx.organizationId || task.requires_reassignment) return false
  if (ctx.isPlatformAdmin) {
    if (task.assignment_kind === 'open_pool') return true
    if (task.assignment_kind !== 'role' || !task.assigned_role) return false
    const role = await req.payload.findByID({
      collection: 'roles',
      id: relationId(task.assigned_role),
      overrideAccess: true,
      req,
      depth: 0,
    })
    return role.slug === 'org_admin'
  }
  const members = await listEligibleTaskMembers(
    req,
    ctx.organizationId,
    task.office ? relationId(task.office) : null,
    reference
  )
  const actor = members.find(member => member.userId === ctx.userId)
  if (!actor) return false
  if (task.assignment_kind === 'open_pool') return true
  if (task.assignment_kind === 'role') {
    return Boolean(task.assigned_role && actor.roleId === relationId(task.assigned_role))
  }
  return Boolean(task.assigned_user && relationId(task.assigned_user) === ctx.userId)
}

export async function assertCanReadTask(
  req: PayloadRequest,
  ctx: TenantContext,
  task: Task
): Promise<ResolvedTaskReference | undefined> {
  assertAction(ctx, 'read')
  assertTaskScope(ctx, task)
  const reference = await assertReferenceReadable(req, ctx, task)
  const manager = canDo(ctx.role, 'tasks', 'assign', ctx.organizationId)
  const involved =
    actorMatches(task.claimed_by, ctx) || relationId(task.assigned_user) === ctx.userId
  if (!manager && !involved && !(await actorIsEligible(req, ctx, task, reference))) {
    throw new TaskDomainError('task_not_found', 404, 'La tarea no existe.')
  }
  return reference
}

async function validateOffices(
  req: PayloadRequest,
  organizationId: string,
  officeIds: string[]
): Promise<void> {
  if (!officeIds.length) return
  const result = await req.payload.find({
    collection: 'offices',
    where: {
      and: [
        { id: { in: officeIds } },
        { organization: { equals: organizationId } },
        { is_active: { equals: true } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 0,
    limit: officeIds.length,
  })
  if (result.docs.length !== officeIds.length) {
    throw new TaskDomainError(
      'invalid_offices',
      400,
      'Una o más oficinas no existen, están inactivas o pertenecen a otra organización.'
    )
  }
}

export async function assertCreationOffices(
  req: PayloadRequest,
  ctx: TenantContext,
  officeIds: string[]
): Promise<void> {
  if (!ctx.organizationId) throw new TaskDomainError('forbidden', 403)
  if (
    !hasOrgWideScope(ctx.role) &&
    (!officeIds.length || officeIds.some(id => !ctx.officeIds.includes(id)))
  )
    throw new TaskDomainError('forbidden', 403, 'Una oficina está fuera de tu alcance.')
  await validateOffices(req, ctx.organizationId, officeIds)
}

export async function assignmentOptionsScope(
  req: PayloadRequest,
  ctx: TenantContext,
  input: { officeIds: string[]; reference?: TaskReferenceInput; taskId?: string }
) {
  if (input.taskId) {
    assertAction(ctx, 'reassign')
    const task = await loadTask(req, input.taskId)
    assertTaskScope(ctx, task)
    if (['completed', 'cancelled'].includes(task.status))
      throw new TaskDomainError('task_terminal', 409)
    const reference = await assertReferenceReadable(req, ctx, task)
    return { offices: [task.office ? relationId(task.office) : null], reference }
  }
  assertAction(ctx, 'create')
  const reference = input.reference ? await resolveTaskReference(req, input.reference) : undefined
  if (reference && !tenantCanReadTaskReference(ctx, reference))
    throw new TaskDomainError('related_entity_not_found', 404)
  const offices = reference ? (reference.officeId ? [reference.officeId] : []) : input.officeIds
  if (
    reference &&
    input.officeIds.length &&
    (offices.length !== input.officeIds.length || input.officeIds.some(id => !offices.includes(id)))
  )
    throw new TaskDomainError('invalid_scope', 400)
  if (!reference && !offices.length && !hasOrgWideScope(ctx.role))
    throw new TaskDomainError('scope_required', 400)
  await assertCreationOffices(req, ctx, offices)
  return { offices: offices.length ? offices : [null], reference }
}

async function createTasksInTransaction(
  req: PayloadRequest,
  ctx: TenantContext,
  input: CreateTasksInput
): Promise<Task[]> {
  assertAction(ctx, 'create')
  const organizationId = ctx.organizationId!
  const reference = input.related_entity
    ? await resolveTaskReference(req, input.related_entity)
    : undefined
  if (reference?.unavailable)
    throw new TaskDomainError(
      'asset_unavailable',
      409,
      'No se pueden crear tareas para un activo retirado o eliminado.'
    )
  if (reference && reference.organizationId !== organizationId) {
    throw new TaskDomainError('related_entity_not_found', 404, 'La entidad no existe.')
  }
  if (reference && !tenantCanReadTaskReference(ctx, reference)) {
    throw new TaskDomainError('related_entity_not_found', 404, 'La entidad no existe.')
  }

  const targetOfficeIds = reference
    ? reference.officeId
      ? [reference.officeId]
      : []
    : input.global
      ? []
      : [...new Set(input.office_ids)]
  await assertCreationOffices(req, ctx, targetOfficeIds)

  const targetOffices: Array<string | null> = targetOfficeIds.length ? targetOfficeIds : [null]
  for (const officeId of targetOffices) {
    await assertTaskAssignmentHasEligibleMember(req, organizationId, officeId, input, reference)
  }

  const now = new Date().toISOString()
  const startAt = input.start_at ?? now
  if (input.due_at && Date.parse(startAt) > Date.parse(input.due_at))
    throw new TaskDomainError('invalid_dates', 400, 'El vencimiento precede al inicio.')
  const ownsTransaction = !req.transactionID
  const transactionID = req.transactionID ?? (await req.payload.db.beginTransaction())
  Object.assign(req, { transactionID })
  const batchId = targetOffices.length > 1 ? crypto.randomUUID() : undefined
  const created: Task[] = []
  try {
    for (const officeId of targetOffices) {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task create, assignment, related entity}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {eligible task audience}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      created.push(
        await req.payload.create({
          collection: 'tasks',
          overrideAccess: true,
          req,
          data: {
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: 'pending',
            start_at: startAt,
            due_at: input.due_at,
            initial_due_at: input.due_at,
            assignment_kind: input.assignment_kind,
            assigned_role: input.assignment_kind === 'role' ? input.assigned_role : undefined,
            assigned_user: input.assignment_kind === 'user' ? input.assigned_user : undefined,
            related_entity: input.related_entity,
            organization: organizationId,
            office: officeId,
            created_by: actorRelation(req, ctx.userId),
            creation_batch_id: batchId,
          },
        })
      )
    }
    if (ownsTransaction && transactionID) await req.payload.db.commitTransaction(transactionID)
    return created
  } catch (error) {
    if (ownsTransaction && transactionID) await req.payload.db.rollbackTransaction(transactionID)
    throw error
  } finally {
    if (ownsTransaction) req.transactionID = undefined
  }
}

export async function createTasks(
  req: PayloadRequest,
  ctx: TenantContext,
  input: CreateTasksInput
): Promise<Task[]> {
  return withTransaction(req.payload, req, async request => {
    const reference = input.related_entity
    if (
      reference &&
      (reference.relationTo === 'assets' || reference.relationTo === 'non-network-assets')
    )
      await lockAssetRow(request, reference.relationTo, reference.value)
    return createTasksInTransaction(request, ctx, input)
  })
}

async function editTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string,
  input: EditTaskInput
): Promise<Task> {
  assertAction(ctx, 'edit')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new TaskDomainError('task_terminal', 409, 'La tarea es terminal y no puede modificarse.')
  }
  await assertReferenceReadable(req, ctx, task)
  const startAt = input.start_at ?? task.start_at
  const dueAt = Object.hasOwn(input, 'due_at') ? input.due_at : task.due_at
  if (dueAt && Date.parse(startAt) > Date.parse(dueAt)) {
    throw new TaskDomainError('invalid_dates', 400, 'El vencimiento precede al inicio.')
  }
  const replanned = task.status === 'in_progress' && Date.parse(startAt) > Date.now()
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task edit, dates, priority}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {current claimant when task details change}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: {
      ...input,
      ...(replanned ? { status: 'pending' as const, claimed_by: null, claimed_at: null } : {}),
    },
  })
}

/** Por qué el sistema liberó una tarea que nadie soltó a mano. */
export type ClaimReleaseReason = 'member_deactivated' | 'office_access_removed' | 'task_reassigned'

export type ClaimEvent = {
  action: 'claimed' | 'released' | 'reassigned'
  at: string
  by: ReturnType<typeof actorRelation> | null
  reason?: ClaimReleaseReason
}

const withClaimEvent = (
  task: Task,
  action: ClaimEvent['action'],
  by: ClaimEvent['by'],
  at: string,
  reason?: ClaimReleaseReason
): ClaimEvent[] => [
  ...(Array.isArray(task.claim_history) ? (task.claim_history as ClaimEvent[]) : []),
  { action, at, by, ...(reason ? { reason } : {}) },
]

const systemActor = (req: PayloadRequest) =>
  req.user ? actorRelation(req, String(req.user.id)) : null

/**
 * Devuelve a pendientes las tareas en curso que tomó una persona que ya no puede completarlas
 * (desactivada, o sin acceso a la oficina de la tarea). Sólo quien reclamó puede liberar a mano
 * (releaseTaskLocked); sin esto la tarea quedaría trabada en curso.
 */
export async function releaseClaimedTasks(
  req: PayloadRequest,
  organizationId: string,
  userId: string,
  offices: 'all' | string[],
  reason: ClaimReleaseReason
): Promise<void> {
  if (Array.isArray(offices) && !offices.length) return
  const claimed = await req.payload.find({
    collection: 'tasks',
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    where: {
      and: [
        { organization: { equals: organizationId } },
        { status: { equals: 'in_progress' } },
        { 'claimed_by.relationTo': { equals: 'users' } },
        { 'claimed_by.value': { equals: userId } },
        ...(offices === 'all' ? [] : [{ office: { in: offices } }]),
      ],
    },
  })
  for (const candidate of claimed.docs.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    await withTaskLock(req, String(candidate.id), async () => {
      const task = await loadTask(req, String(candidate.id))
      if (task.status !== 'in_progress' || relationId(task.claimed_by) !== userId) return
      // AUDIT: this action must emit an AuditLogs entry (task release by system, reason {member_deactivated|office_access_removed}, chain_hash over {task, previous claimant, reason}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {task managers and eligible audience}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await req.payload.update({
        collection: 'tasks',
        id: task.id,
        overrideAccess: true,
        req,
        data: {
          status: 'pending',
          claimed_by: null,
          claimed_at: null,
          claim_history: withClaimEvent(
            task,
            'released',
            systemActor(req),
            new Date().toISOString(),
            reason
          ),
        },
      })
    })
  }
}

/**
 * Cancela en bloque las tareas abiertas (pendientes o en curso) que dejaron de tener sentido
 * porque su oficina u organización se desactivó. Mismo patrón que reconcileAssetTasks: escritura
 * directa bajo withTaskLock; cancelTaskLocked sólo cancela en curso y exige RBAC del actor.
 */
export async function cancelOpenTasks(
  req: PayloadRequest,
  scope: { organizationId: string; officeId?: string },
  reason: string
): Promise<number> {
  const open = await req.payload.find({
    collection: 'tasks',
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    where: {
      and: [
        { organization: { equals: scope.organizationId } },
        { status: { in: ['pending', 'in_progress'] } },
        ...(scope.officeId ? [{ office: { equals: scope.officeId } }] : []),
      ],
    },
  })
  let cancelled = 0
  for (const candidate of open.docs.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    await withTaskLock(req, String(candidate.id), async () => {
      const task = await loadTask(req, String(candidate.id))
      if (task.status === 'completed' || task.status === 'cancelled') return
      // AUDIT: this action must emit an AuditLogs entry (task.cancel by system, chain_hash over {task, cancellation_reason}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {claimant and assigned audience of the task}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await req.payload.update({
        collection: 'tasks',
        id: task.id,
        overrideAccess: true,
        req,
        data: {
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: systemActor(req),
          cancellation_reason: reason,
          requires_reassignment: false,
        },
      })
      cancelled += 1
    })
  }
  return cancelled
}

async function claimTaskLocked(req: PayloadRequest, ctx: TenantContext, id: string): Promise<Task> {
  assertAction(ctx, 'claim')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  const reference = await assertReferenceReadable(req, ctx, task)
  if (task.status !== 'pending') {
    throw new TaskDomainError('task_not_pending', 409, 'La tarea no está pendiente.')
  }
  if (effectiveTaskStatus(task) === 'planned') {
    throw new TaskDomainError('task_planned', 400, 'La tarea todavía está planificada.')
  }
  if (!(await actorIsEligible(req, ctx, task, reference))) {
    throw new TaskDomainError('not_eligible', 403, 'No eres elegible para reclamar esta tarea.')
  }
  const now = new Date().toISOString()
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task claim, claimant}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {task creator and managers}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  const result = await req.payload.update({
    collection: 'tasks',
    where: { and: [{ id: { equals: id } }, { status: { equals: 'pending' } }] },
    limit: 1,
    overrideAccess: true,
    req,
    data: {
      status: 'in_progress',
      claimed_by: actorRelation(req, ctx.userId),
      claimed_at: now,
      claim_history: withClaimEvent(task, 'claimed', actorRelation(req, ctx.userId), now),
    },
  })
  const updated = result.docs[0]
  if (!updated) throw new TaskDomainError('already_claimed', 409, 'La tarea ya fue reclamada.')
  return updated
}

async function releaseTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'release')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status !== 'in_progress' || !actorMatches(task.claimed_by, ctx)) {
    throw new TaskDomainError('not_claimant', 403, 'Sólo quien reclamó la tarea puede liberarla.')
  }
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task release, claimant}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {task managers and eligible audience}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: {
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
      // Liberar suma un paso a la actividad en vez de borrar quién la tenía.
      claim_history: withClaimEvent(
        task,
        'released',
        actorRelation(req, ctx.userId),
        new Date().toISOString()
      ),
    },
  })
}

async function reassignTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string,
  assignment: ReassignTaskInput
): Promise<Task> {
  assertAction(ctx, 'reassign')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new TaskDomainError('task_terminal', 409, 'La tarea es terminal y no puede modificarse.')
  }
  const reference = await assertReferenceReadable(req, ctx, task)
  await assertTaskAssignmentHasEligibleMember(
    req,
    relationId(task.organization),
    task.office ? relationId(task.office) : null,
    assignment,
    reference
  )
  const now = new Date().toISOString()
  const actor = actorRelation(req, ctx.userId)
  const releasedTask =
    task.status === 'in_progress' && task.claimed_by
      ? { ...task, claim_history: withClaimEvent(task, 'released', actor, now, 'task_reassigned') }
      : task
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task reassignment}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {previous claimant and new eligible audience}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: {
      requires_reassignment: false,
      assignment_kind: assignment.assignment_kind,
      assigned_role: assignment.assignment_kind === 'role' ? assignment.assigned_role : null,
      assigned_user: assignment.assignment_kind === 'user' ? assignment.assigned_user : null,
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
      claim_history: withClaimEvent(releasedTask, 'reassigned', actor, now),
    },
  })
}

async function completeTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'complete')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  await assertReferenceReadable(req, ctx, task)
  if (task.status !== 'in_progress' || !actorMatches(task.claimed_by, ctx)) {
    throw new TaskDomainError(
      'not_claimant',
      403,
      'Sólo quien está realizando la tarea puede completarla.'
    )
  }
  const now = new Date().toISOString()
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task complete, completed_by, completed_at}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {task creator and managers}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: { status: 'completed', completed_by: actorRelation(req, ctx.userId), completed_at: now },
  })
}

async function forceCompleteTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string,
  reason: string
): Promise<Task> {
  assertAction(ctx, 'complete')
  if (!ctx.isPlatformAdmin && ctx.role !== 'org_admin') {
    throw new TaskDomainError('forbidden', 403, 'No tienes permiso para completar esta tarea.')
  }
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  await assertReferenceReadable(req, ctx, task)
  if (task.status !== 'in_progress' || !task.claimed_by || actorMatches(task.claimed_by, ctx)) {
    throw new TaskDomainError(
      'task_not_force_completable',
      409,
      'Sólo puedes completar de forma forzada una tarea en progreso reclamada por otra persona.'
    )
  }
  const now = new Date().toISOString()
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task force complete, completed_by, completed_at, completion_reason}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {claimant, task creator and managers}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: {
      status: 'completed',
      completed_by: actorRelation(req, ctx.userId),
      completed_at: now,
      completion_reason: reason,
    },
  })
}

async function cancelTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string,
  reason: string
): Promise<Task> {
  assertAction(ctx, 'cancel')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  await assertReferenceReadable(req, ctx, task)
  if (task.status !== 'in_progress') {
    throw new TaskDomainError('task_not_in_progress', 409, 'Sólo se cancelan tareas en progreso.')
  }
  const now = new Date().toISOString()
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task cancel, reason}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {claimant, task creator and managers}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: {
      status: 'cancelled',
      cancelled_by: actorRelation(req, ctx.userId),
      cancelled_at: now,
      cancellation_reason: reason,
    },
  })
}

async function archiveTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'archive')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status !== 'completed' && task.status !== 'cancelled') {
    throw new TaskDomainError('task_not_terminal', 409, 'Sólo se archivan tareas terminales.')
  }
  if (task.archived_at) return task
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task archive}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  return req.payload.update({
    collection: 'tasks',
    id,
    overrideAccess: true,
    req,
    data: { archived_by: actorRelation(req, ctx.userId), archived_at: new Date().toISOString() },
  })
}

async function deletePendingTaskLocked(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'delete')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status !== 'pending' || task.claimed_at) {
    throw new TaskDomainError(
      'task_cannot_be_deleted',
      409,
      'Sólo se eliminan tareas pendientes que nunca fueron reclamadas.'
    )
  }
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {task delete}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  return req.payload.delete({ collection: 'tasks', id, overrideAccess: true, req })
}

/**
 * Tarea lista para responder por la API. `claim_history` queda en el servidor: guarda IDs de
 * quienes reclamaron o liberaron, y la actividad ya recibe esos pasos con nombres en
 * `actor_labels.claim_events`.
 */
export function taskWithDerivedState(task: Task) {
  const { claim_history: _claimHistory, ...publicTask } = task
  return { ...publicTask, effective_status: effectiveTaskStatus(task) }
}

export async function availableTaskActions(
  req: PayloadRequest,
  ctx: TenantContext,
  task: Task,
  reference?: ResolvedTaskReference
): Promise<string[]> {
  const organizationId = ctx.organizationId
  const role = ctx.role
  if (!organizationId || !role) return []
  const actions: string[] = []
  const terminal = task.status === 'completed' || task.status === 'cancelled'
  const claimant = actorMatches(task.claimed_by, ctx)
  const taskAdmin = ctx.isPlatformAdmin || ctx.role === 'org_admin'
  const managerCan = (action: Action) => canDo(role, 'tasks', action, organizationId)
  if (!terminal && managerCan('edit')) actions.push('edit')
  if (
    task.status === 'pending' &&
    effectiveTaskStatus(task) === 'pending' &&
    managerCan('claim') &&
    (await actorIsEligible(req, ctx, task, reference))
  ) {
    actions.push('claim')
  }
  if (task.status === 'in_progress' && claimant && managerCan('release')) actions.push('release')
  if (!terminal && managerCan('reassign')) actions.push('reassign')
  if (task.status === 'in_progress' && claimant && managerCan('complete')) actions.push('complete')
  if (
    task.status === 'in_progress' &&
    task.claimed_by &&
    !claimant &&
    taskAdmin &&
    managerCan('complete')
  ) {
    actions.push('force_complete')
  }
  if (task.status === 'in_progress' && managerCan('cancel')) actions.push('cancel')
  if (terminal && !task.archived_at && managerCan('archive')) actions.push('archive')
  if (task.status === 'pending' && !task.claimed_at && managerCan('delete')) actions.push('delete')
  return actions
}

export async function taskRequiresReassignment(
  req: PayloadRequest,
  task: Task,
  reference?: ResolvedTaskReference
): Promise<boolean> {
  if (task.status === 'completed' || task.status === 'cancelled') return false
  if (task.requires_reassignment) return true
  const members = await listEligibleTaskMembers(
    req,
    relationId(task.organization),
    task.office ? relationId(task.office) : null,
    reference
  )
  return (
    assignmentEligibleMembers(members, {
      assignment_kind: task.assignment_kind,
      assigned_role: task.assigned_role ? relationId(task.assigned_role) : undefined,
      assigned_user: task.assigned_user ? relationId(task.assigned_user) : undefined,
    } as Parameters<typeof assignmentEligibleMembers>[1]).length === 0
  )
}

export const editTask: typeof editTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => editTaskLocked(...args))

export const claimTask: typeof claimTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => claimTaskLocked(...args))

export const releaseTask: typeof releaseTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => releaseTaskLocked(...args))

export const reassignTask: typeof reassignTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => reassignTaskLocked(...args))

export const completeTask: typeof completeTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => completeTaskLocked(...args))

export const forceCompleteTask: typeof forceCompleteTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => forceCompleteTaskLocked(...args))

export const cancelTask: typeof cancelTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => cancelTaskLocked(...args))

export const archiveTask: typeof archiveTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => archiveTaskLocked(...args))

export const deletePendingTask: typeof deletePendingTaskLocked = (...args) =>
  withTaskLock(args[0], args[2], () => deletePendingTaskLocked(...args))
