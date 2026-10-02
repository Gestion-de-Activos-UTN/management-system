import { z } from 'zod'

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const TASK_ASSIGNMENT_KINDS = ['open_pool', 'role', 'user'] as const
export const TASK_REFERENCE_COLLECTIONS = [
  'offices',
  'assets',
  'non-network-assets',
  'assessment-instances',
  'compliance-results',
  'inventory-snapshots',
  'scan-reports',
  'risk-evaluations',
  'agents',
] as const

const optionalDate = z.string().datetime({ offset: true }).optional()

export const TaskReferenceSchema = z.object({
  relationTo: z.enum(TASK_REFERENCE_COLLECTIONS),
  value: z.string().min(1),
})

const TaskAssignmentSchema = z.discriminatedUnion('assignment_kind', [
  z.object({
    assignment_kind: z.literal('open_pool'),
    assigned_role: z.never().optional(),
    assigned_user: z.never().optional(),
  }),
  z.object({
    assignment_kind: z.literal('role'),
    assigned_role: z.string().min(1),
    assigned_user: z.never().optional(),
  }),
  z.object({
    assignment_kind: z.literal('user'),
    assigned_user: z.string().min(1),
    assigned_role: z.never().optional(),
  }),
])

const TaskBusinessFieldsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(TASK_PRIORITIES),
  start_at: optionalDate,
  due_at: optionalDate,
})

function validateDates(value: { start_at?: string; due_at?: string | null }, ctx: z.RefinementCtx) {
  if (value.start_at && value.due_at && Date.parse(value.start_at) > Date.parse(value.due_at)) {
    ctx.addIssue({
      code: 'custom',
      path: ['due_at'],
      message: 'La fecha de vencimiento no puede ser anterior a la fecha de inicio.',
    })
  }
}

export const CreateTasksSchema = z
  .intersection(
    TaskBusinessFieldsSchema.extend({
      global: z.boolean(),
      office_ids: z.array(z.string().min(1)).max(500),
      related_entity: TaskReferenceSchema.optional(),
    }),
    TaskAssignmentSchema
  )
  .superRefine((value, ctx) => {
    validateDates(value, ctx)
    const uniqueOfficeIds = new Set(value.office_ids)
    if (uniqueOfficeIds.size !== value.office_ids.length) {
      ctx.addIssue({ code: 'custom', path: ['office_ids'], message: 'Hay oficinas repetidas.' })
    }
    if (value.global && value.office_ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['office_ids'],
        message: 'Una tarea global no puede indicar oficinas.',
      })
    }
    if (!value.global && value.office_ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['office_ids'],
        message: 'Selecciona al menos una oficina.',
      })
    }
  })

export const EditTaskSchema = TaskBusinessFieldsSchema.partial()
  .extend({ due_at: optionalDate.nullable() })
  .superRefine(validateDates)

export const ReassignTaskSchema = TaskAssignmentSchema
export const CancelTaskSchema = z.object({ reason: z.string().trim().min(3).max(500) })

export const TaskListQuerySchema = z.object({
  view: z.enum(['mine', 'pool', 'all']).default('mine'),
  status: z.enum(['planned', 'pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  office_id: z.string().min(1).optional(),
  include_archived: z.coerce.boolean().default(false),
})

export type CreateTasksInput = z.infer<typeof CreateTasksSchema>
export type EditTaskInput = z.infer<typeof EditTaskSchema>
export type ReassignTaskInput = z.infer<typeof ReassignTaskSchema>
export type TaskReferenceInput = z.infer<typeof TaskReferenceSchema>
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>
