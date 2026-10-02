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
  if (!ctx.organizationId) return false
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
    relationId(task.claimed_by) === ctx.userId || relationId(task.assigned_user) === ctx.userId
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

export async function createTasks(
  req: PayloadRequest,
  ctx: TenantContext,
  input: CreateTasksInput
): Promise<Task[]> {
  assertAction(ctx, 'create')
  const organizationId = ctx.organizationId!
  const reference = input.related_entity
    ? await resolveTaskReference(req, input.related_entity)
    : undefined
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
  if (!hasOrgWideScope(ctx.role)) {
    if (!targetOfficeIds.length || targetOfficeIds.some(id => !ctx.officeIds.includes(id))) {
      throw new TaskDomainError('forbidden', 403, 'Una oficina está fuera de tu alcance.')
    }
  }
  await validateOffices(req, organizationId, targetOfficeIds)

  const targetOffices: Array<string | null> = targetOfficeIds.length ? targetOfficeIds : [null]
  for (const officeId of targetOffices) {
    await assertTaskAssignmentHasEligibleMember(req, organizationId, officeId, input, reference)
  }

  const ownsTransaction = !req.transactionID
  const transactionID = req.transactionID ?? (await req.payload.db.beginTransaction())
  Object.assign(req, { transactionID })
  const now = new Date().toISOString()
  const startAt = input.start_at ?? now
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
            created_by: ctx.userId,
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
  }
}

export async function editTask(
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

export async function claimTask(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
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
    data: { status: 'in_progress', claimed_by: ctx.userId, claimed_at: now },
  })
  const updated = result.docs[0]
  if (!updated) throw new TaskDomainError('already_claimed', 409, 'La tarea ya fue reclamada.')
  return updated
}

export async function releaseTask(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'release')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  if (task.status !== 'in_progress' || relationId(task.claimed_by) !== ctx.userId) {
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
    data: { status: 'pending', claimed_by: null, claimed_at: null },
  })
}

export async function reassignTask(
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
      assignment_kind: assignment.assignment_kind,
      assigned_role: assignment.assignment_kind === 'role' ? assignment.assigned_role : null,
      assigned_user: assignment.assignment_kind === 'user' ? assignment.assigned_user : null,
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
    },
  })
}

export async function completeTask(
  req: PayloadRequest,
  ctx: TenantContext,
  id: string
): Promise<Task> {
  assertAction(ctx, 'complete')
  const task = await loadTask(req, id)
  assertTaskScope(ctx, task)
  await assertReferenceReadable(req, ctx, task)
  if (task.status !== 'in_progress' || relationId(task.claimed_by) !== ctx.userId) {
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
    data: { status: 'completed', completed_by: ctx.userId, completed_at: now },
  })
}

export async function cancelTask(
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
      cancelled_by: ctx.userId,
      cancelled_at: now,
      cancellation_reason: reason,
    },
  })
}

export async function archiveTask(
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
    data: { archived_by: ctx.userId, archived_at: new Date().toISOString() },
  })
}

export async function deletePendingTask(
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

export function taskWithDerivedState(task: Task) {
  return { ...task, effective_status: effectiveTaskStatus(task) }
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
  const claimant = relationId(task.claimed_by) === ctx.userId
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
