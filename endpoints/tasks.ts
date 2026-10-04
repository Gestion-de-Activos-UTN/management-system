import type { Endpoint, PayloadRequest, Where } from 'payload'
import type { Task } from '@/app/types/payload-types'
import { getTenantContext, type TenantContext } from '@/access/tenant/resolveTenantContext'
import { canDo, hasOrgWideScope } from '@/access/rbac/permissions'
import { relationId } from '@/lib/relationId'
import {
  CancelTaskSchema,
  CreateTasksSchema,
  EditTaskSchema,
  ReassignTaskSchema,
  TASK_REFERENCE_COLLECTIONS,
  TaskListQuerySchema,
  TaskReferenceSchema,
} from '@/modules/tasks/schema'
import {
  archiveTask,
  availableTaskActions,
  assertCanReadTask,
  cancelTask,
  claimTask,
  completeTask,
  createTasks,
  deletePendingTask,
  editTask,
  loadTask,
  reassignTask,
  releaseTask,
  taskWithDerivedState,
  taskRequiresReassignment,
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
      if (parsed.data.priority) clauses.push({ priority: { equals: parsed.data.priority } })
      if (!parsed.data.include_archived) clauses.push({ archived_at: { exists: false } })
      if (parsed.data.status && parsed.data.status !== 'planned') {
        clauses.push({ status: { equals: parsed.data.status } })
      }

      const result = await req.payload.find({
        collection: 'tasks',
        where: { and: clauses },
        overrideAccess: true,
        req,
        depth: 0,
        sort: 'due_at,-createdAt',
        limit: 1000,
      })

      const visible = await Promise.all(
        result.docs.map(async task => {
          try {
            const reference = await assertCanReadTask(req, ctx, task)
            const effective = taskWithDerivedState(task)
            if (parsed.data.status && effective.effective_status !== parsed.data.status) return null
            if (parsed.data.view === 'mine') {
              const mine =
                relationId(task.claimed_by) === ctx.userId ||
                relationId(task.assigned_user) === ctx.userId
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
      if (!canDo(ctx.role, 'tasks', 'create', ctx.organizationId))
        return json({ error: 'forbidden' }, 403)
      const params = new URL(req.url ?? 'http://localhost', 'http://localhost').searchParams
      const officeId = params.get('office_id')
      const officeIds =
        params
          .get('office_ids')
          ?.split(',')
          .map(value => value.trim())
          .filter(Boolean) ?? []
      const rawReference = params.get('reference_type')
        ? { relationTo: params.get('reference_type'), value: params.get('reference_id') }
        : undefined
      const parsedReference = rawReference ? TaskReferenceSchema.safeParse(rawReference) : null
      if (parsedReference && !parsedReference.success)
        return json({ error: 'invalid_reference' }, 400)
      const reference = parsedReference?.success
        ? await resolveTaskReference(req, parsedReference.data)
        : undefined
      if (reference && !tenantCanReadTaskReference(ctx, reference))
        return json({ error: 'forbidden' }, 403)
      const targetOffices = reference
        ? [reference.officeId]
        : officeIds.length
          ? officeIds
          : [officeId]
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
  cancelTaskEndpoint,
  commandEndpoint('/v1/tasks/:id/archive', archiveTask),
  deleteTaskEndpoint,
]
