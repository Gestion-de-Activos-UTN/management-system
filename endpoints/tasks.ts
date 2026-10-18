import { actorMatches } from '@/lib/actor-relation'
import type { Endpoint, PayloadRequest, Where } from 'payload'
import type { Task } from '@/app/types/payload-types'
import { getTenantContext, type TenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import {
  CancelTaskSchema,
  CreateTasksSchema,
  EditTaskSchema,
  ForceCompleteTaskSchema,
  ReassignTaskSchema,
  TASK_REFERENCE_COLLECTIONS,
  TaskListQuerySchema,
  TaskReferenceSchema,
  TaskAssignmentOptionsQuerySchema,
} from '@/modules/tasks/schema'
import {
  archiveTask,
  assignmentOptionsScope,
  availableTaskActions,
  assertCanReadTask,
  cancelTask,
  claimTask,
  completeTask,
  forceCompleteTask,
  createTasks,
  deletePendingTask,
  editTask,
  loadTask,
  reassignTask,
  releaseTask,
  taskWithDerivedState,
  taskRequiresReassignment,
  type ClaimEvent,
} from '@/domain/tasks/task-actions'
import { TaskDomainError, taskErrorResponse } from '@/domain/tasks/task-error'
import { listEligibleTaskMembers } from '@/domain/tasks/task-eligibility'
import { resolveTaskReference, tenantCanReadTaskReference } from '@/domain/tasks/task-reference'
import { defaultFeatures } from '@/domain/subscriptions/features'

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function authenticated(req: PayloadRequest): Promise<TenantContext | Response> {
  const ctx = await getTenantContext(req)
  if (!ctx || !ctx.isActive) return json({ error: 'unauthenticated' }, 401)
  if (!ctx.organizationId) return json({ error: 'organization_context_required' }, 400)
  return ctx
}

async function featureEnabled(req: PayloadRequest, organizationId: string): Promise<boolean> {
  const result = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const features = result.docs[0]?.features
  const normalized = {
    ...defaultFeatures(),
    ...(features && typeof features === 'object' && !Array.isArray(features) ? features : {}),
  }
  return normalized.tasks === true
}

async function withTaskErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (error) {
    return taskErrorResponse(error)
  }
}

async function taskContext(req: PayloadRequest): Promise<TenantContext | Response> {
  const ctx = await authenticated(req)
  if (ctx instanceof Response) return ctx
  if (!(await featureEnabled(req, ctx.organizationId!))) {
    return json({ error: 'feature_disabled' }, 403)
  }
  return ctx
}

function taskId(req: PayloadRequest): string {
  return String(req.routeParams?.id ?? '')
}

function parseListQuery(req: PayloadRequest) {
  const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
  return TaskListQuerySchema.safeParse({
    view: params.get('view') ?? undefined,
    status: params.get('status') ?? undefined,
    priority: params.get('priority') ?? undefined,
    office_id: params.get('office_id') ?? undefined,
    include_archived: params.get('include_archived') ?? undefined,
  })
}

function taskReferenceInfo(
  task: Task,
  resolved?: Awaited<ReturnType<typeof resolveTaskReference>>
) {
  if (!task.related_entity) return null
  return {
    relationTo: task.related_entity.relationTo,
    value: relationId(task.related_entity.value),
    available: Boolean(resolved),
    label: resolved?.label ?? null,
    office_id: resolved?.officeId ?? null,
  }
}

type TaskActorCollection = 'users' | 'admins'

type TaskActorReference = { collection: TaskActorCollection | null; id: string }

function taskActorReference(value: unknown): TaskActorReference | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' && 'relationTo' in value && 'value' in value) {
    const collection = value.relationTo
    if (collection !== 'users' && collection !== 'admins') return null
    const id = relationId(value.value)
    return id ? { collection, id } : null
  }
  // At depth 0 Payload may return a polymorphic relationship as a raw id. Resolve it against
  // both actor collections; platform admins do not have a Users document.
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value)
    return id ? { collection: null, id } : null
  }
  return null
}

async function taskActorLabels(req: PayloadRequest, task: Task) {
  const actorFields = {
    created_by: task.created_by,
    claimed_by: task.claimed_by,
    completed_by: task.completed_by,
    cancelled_by: task.cancelled_by,
    archived_by: task.archived_by,
  } as const
  const references = Object.fromEntries(
    Object.entries(actorFields).map(([field, value]) => [field, taskActorReference(value)])
  ) as Record<keyof typeof actorFields, ReturnType<typeof taskActorReference>>
  const claimHistory = (Array.isArray(task.claim_history) ? task.claim_history : []) as ClaimEvent[]
  const claimReferences = claimHistory.map(event => taskActorReference(event.by))
  const idsByCollection: Record<TaskActorCollection, Set<string>> = {
    users: new Set(),
    admins: new Set(),
  }
  for (const reference of [...Object.values(references), ...claimReferences]) {
    if (!reference) continue
    if (reference.collection) idsByCollection[reference.collection].add(reference.id)
    else {
      idsByCollection.users.add(reference.id)
      idsByCollection.admins.add(reference.id)
    }
  }

  const [users, admins] = await Promise.all([
    idsByCollection.users.size
      ? req.payload.find({
          collection: 'users',
          where: { id: { in: [...idsByCollection.users] } },
          select: { name: true, email: true },
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
        })
      : Promise.resolve({ docs: [] }),
    idsByCollection.admins.size
      ? req.payload.find({
          collection: 'admins',
          where: { id: { in: [...idsByCollection.admins] } },
          select: { name: true, email: true },
          overrideAccess: true,
          req,
          depth: 0,
          pagination: false,
        })
      : Promise.resolve({ docs: [] }),
  ])
  const labels = new Map<string, string>()
  const labelsById = new Map<string, string>()
  for (const user of users.docs) {
    const label = user.name || user.email
    labels.set(`users:${user.id}`, label)
    labelsById.set(user.id, label)
  }
  for (const admin of admins.docs) {
    const label = admin.name?.trim() || 'Administrador de plataforma'
    labels.set(`admins:${admin.id}`, label)
    if (!labelsById.has(admin.id)) labelsById.set(admin.id, label)
  }

  const resolve = (reference: TaskActorReference | null) =>
    reference
      ? reference.collection
        ? (labels.get(`${reference.collection}:${reference.id}`) ?? null)
        : (labelsById.get(reference.id) ?? null)
      : null
  return {
    ...(Object.fromEntries(
      Object.entries(references).map(([field, reference]) => [field, resolve(reference)])
    ) as Record<keyof typeof actorFields, string | null>),
    claim_events: claimHistory.map((event, index) => ({
      action: event.action,
      at: event.at,
      actor: resolve(claimReferences[index]),
      ...(event.reason ? { reason: event.reason } : {}),
    })),
  }
}

const listTasksEndpoint: Endpoint = {
  path: '/v1/tasks',
  method: 'get',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = parseListQuery(req)
      if (!parsed.success) return json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
      if (
        parsed.data.office_id &&
        !hasOrgWideScope(ctx.role) &&
        !ctx.officeIds.includes(parsed.data.office_id)
      ) {
        return json({ error: 'forbidden' }, 403)
      }
      if (parsed.data.view === 'all' && !canDo(ctx.role, 'tasks', 'assign', ctx.organizationId)) {
        return json({ error: 'forbidden' }, 403)
      }

      const clauses: Where[] = [{ organization: { equals: ctx.organizationId } }]
      if (!hasOrgWideScope(ctx.role)) {
        clauses.push({
          or: [{ office: { in: ctx.officeIds } }, { office: { exists: false } }],
        })
      }
      if (parsed.data.office_id) clauses.push({ office: { equals: parsed.data.office_id } })
      if (parsed.data.priority) clauses.push({ priority: { in: parsed.data.priority } })
      if (!parsed.data.include_archived) clauses.push({ archived_at: { exists: false } })
      // "Planificada" no se guarda: es una pendiente con inicio futuro, así que en la base se
      // busca como pendiente y después se filtra por el estado efectivo.
      const statuses: readonly string[] | null = parsed.data.status ?? null
      if (statuses) {
        const stored = statuses.map(value => (value === 'planned' ? 'pending' : value))
        clauses.push({ status: { in: [...new Set(stored)] } })
      }

      const result = await req.payload.find({
        collection: 'tasks',
        where: { and: clauses },
        overrideAccess: true,
        req,
        depth: 0,
        sort: 'due_at,-createdAt',
        pagination: false,
      })

      const visible = await Promise.all(
        result.docs.map(async task => {
          try {
            const reference = await assertCanReadTask(req, ctx, task)
            const effective = taskWithDerivedState(task)
            if (statuses && !statuses.includes(effective.effective_status)) return null
            if (parsed.data.view === 'mine') {
              const mine =
                actorMatches(task.claimed_by, ctx) || relationId(task.assigned_user) === ctx.userId
              if (!mine) return null
            }
            if (parsed.data.view === 'pool') {
              if (task.status !== 'pending' || task.assignment_kind === 'user') return null
            }
            return {
              ...effective,
              related_entity_info: taskReferenceInfo(task, reference),
              available_actions: await availableTaskActions(req, ctx, task, reference),
              requires_reassignment: await taskRequiresReassignment(req, task, reference),
            }
          } catch (error) {
            if (error instanceof TaskDomainError && error.status === 404) return null
            throw error
          }
        })
      )
      const docs = visible.filter(Boolean)
      return json({ docs, totalDocs: docs.length })
    }),
}

const taskDetailEndpoint: Endpoint = {
  path: '/v1/tasks/:id',
  method: 'get',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const task = await loadTask(req, taskId(req))
      const reference = await assertCanReadTask(req, ctx, task)
      return json({
        ...taskWithDerivedState(task),
        actor_labels: await taskActorLabels(req, task),
        related_entity_info: taskReferenceInfo(task, reference),
        available_actions: await availableTaskActions(req, ctx, task, reference),
        requires_reassignment: await taskRequiresReassignment(req, task, reference),
      })
    }),
}

const createTasksEndpoint: Endpoint = {
  path: '/v1/tasks',
  method: 'post',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = CreateTasksSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success) return json({ error: 'invalid_task', issues: parsed.error.issues }, 400)
      const tasks = await createTasks(req, ctx, parsed.data)
      return json({ docs: tasks.map(taskWithDerivedState), totalDocs: tasks.length }, 201)
    }),
}

const editTaskEndpoint: Endpoint = {
  path: '/v1/tasks/:id',
  method: 'patch',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = EditTaskSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success) return json({ error: 'invalid_task', issues: parsed.error.issues }, 400)
      return json(taskWithDerivedState(await editTask(req, ctx, taskId(req), parsed.data)))
    }),
}

function commandEndpoint(
  path: string,
  command: (req: PayloadRequest, ctx: TenantContext, id: string) => Promise<Task>
): Endpoint {
  return {
    path,
    method: 'post',
    handler: req =>
      withTaskErrors(async () => {
        const ctx = await taskContext(req)
        if (ctx instanceof Response) return ctx
        return json(taskWithDerivedState(await command(req, ctx, taskId(req))))
      }),
  }
}

const reassignTaskEndpoint: Endpoint = {
  path: '/v1/tasks/:id/reassign',
  method: 'post',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = ReassignTaskSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_assignment', issues: parsed.error.issues }, 400)
      return json(taskWithDerivedState(await reassignTask(req, ctx, taskId(req), parsed.data)))
    }),
}

const cancelTaskEndpoint: Endpoint = {
  path: '/v1/tasks/:id/cancel',
  method: 'post',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = CancelTaskSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_reason', issues: parsed.error.issues }, 400)
      return json(taskWithDerivedState(await cancelTask(req, ctx, taskId(req), parsed.data.reason)))
    }),
}

const forceCompleteTaskEndpoint: Endpoint = {
  path: '/v1/tasks/:id/force-complete',
  method: 'post',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const parsed = ForceCompleteTaskSchema.safeParse(await req.json!().catch(() => ({})))
      if (!parsed.success)
        return json({ error: 'invalid_reason', issues: parsed.error.issues }, 400)
      return json(
        taskWithDerivedState(await forceCompleteTask(req, ctx, taskId(req), parsed.data.reason))
      )
    }),
}

const deleteTaskEndpoint: Endpoint = {
  path: '/v1/tasks/:id',
  method: 'delete',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      return json(await deletePendingTask(req, ctx, taskId(req)))
    }),
}

const assignmentOptionsEndpoint: Endpoint = {
  path: '/v1/tasks/assignment-options',
  method: 'get',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
      for (const key of ['office_id', 'office_ids', 'reference_type', 'reference_id', 'task_id'])
        if (params.getAll(key).length > 1) return json({ error: 'invalid_query' }, 400)
      const query = TaskAssignmentOptionsQuerySchema.safeParse({
        office_id: params.get('office_id') ?? undefined,
        office_ids: params.has('office_ids')
          ? params
              .get('office_ids')!
              .split(',')
              .map(id => id.trim())
          : undefined,
        task_id: params.get('task_id') ?? undefined,
        reference_type: params.get('reference_type') ?? undefined,
        reference_id: params.get('reference_id') ?? undefined,
      })
      if (!query.success) return json({ error: 'invalid_query', issues: query.error.issues }, 400)
      const { office_id: officeId, office_ids: officeIds = [], task_id: taskId } = query.data
      const { offices: targetOffices, reference } = await assignmentOptionsScope(req, ctx, {
        officeIds: [...new Set(officeIds.length ? officeIds : officeId ? [officeId] : [])],
        reference:
          query.data.reference_type && query.data.reference_id
            ? { relationTo: query.data.reference_type, value: query.data.reference_id }
            : undefined,
        taskId: taskId ?? undefined,
      })
      const memberSets = await Promise.all(
        targetOffices.map(targetOffice =>
          listEligibleTaskMembers(req, ctx.organizationId!, targetOffice, reference)
        )
      )
      const firstMembers = memberSets[0] ?? []
      const members = firstMembers.filter(member =>
        memberSets.every(set => set.some(candidate => candidate.userId === member.userId))
      )
      const firstRoles = new Map(
        firstMembers.map(member => [member.roleId, { id: member.roleId, slug: member.role }])
      )
      const roles = Array.from(firstRoles.values()).filter(role =>
        memberSets.every(set => set.some(member => member.roleId === role.id))
      )
      return json({
        users: members.map(member => ({
          id: member.userId,
          name: member.name,
          email: member.email,
          role_id: member.roleId,
          role: member.role,
        })),
        roles,
      })
    }),
}

const referenceOptionsEndpoint: Endpoint = {
  path: '/v1/tasks/reference-options',
  method: 'get',
  handler: req =>
    withTaskErrors(async () => {
      const ctx = await taskContext(req)
      if (ctx instanceof Response) return ctx
      if (!canDo(ctx.role, 'tasks', 'create', ctx.organizationId))
        return json({ error: 'forbidden' }, 403)
      const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
      const relationTo = params.get('type')
      if (!TASK_REFERENCE_COLLECTIONS.includes(relationTo as never)) {
        return json({ error: 'invalid_reference_type' }, 400)
      }
      const collection = relationTo as (typeof TASK_REFERENCE_COLLECTIONS)[number]
      const officeId = params.get('office_id')
      const selectedId = params.get('id')
      const base: Where[] = []
      if (selectedId) base.push({ id: { equals: selectedId } })
      if (collection === 'scan-reports') {
        base.push({ office: { in: officeId ? [officeId] : ctx.officeIds } })
      } else if (collection === 'offices') {
        base.push({ organization: { equals: ctx.organizationId } }, { is_active: { equals: true } })
      } else {
        base.push({ organization: { equals: ctx.organizationId } })
        if (officeId) base.push({ office: { equals: officeId } })
        else if (!hasOrgWideScope(ctx.role)) base.push({ office: { in: ctx.officeIds } })
      }
      const found = await req.payload.find({
        collection,
        where: { and: base },
        overrideAccess: true,
        req,
        depth: 0,
        limit: 100,
        sort: '-updatedAt',
      })
      const options = []
      for (const doc of found.docs) {
        const reference = await resolveTaskReference(req, {
          relationTo: collection,
          value: String(doc.id),
        })
        if (tenantCanReadTaskReference(ctx, reference)) {
          options.push({
            relationTo: collection,
            value: String(doc.id),
            label: reference.label,
            office_id: reference.officeId,
          })
        }
      }
      return json({ docs: options })
    }),
}

export const taskEndpoints: Endpoint[] = [
  assignmentOptionsEndpoint,
  referenceOptionsEndpoint,
  listTasksEndpoint,
  taskDetailEndpoint,
  createTasksEndpoint,
  editTaskEndpoint,
  commandEndpoint('/v1/tasks/:id/claim', claimTask),
  commandEndpoint('/v1/tasks/:id/release', releaseTask),
  reassignTaskEndpoint,
  commandEndpoint('/v1/tasks/:id/complete', completeTask),
  forceCompleteTaskEndpoint,
  cancelTaskEndpoint,
  commandEndpoint('/v1/tasks/:id/archive', archiveTask),
  deleteTaskEndpoint,
]
