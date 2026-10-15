import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'

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
  title: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .regex(...TEXT_RULES.title),
  description: z
    .string()
    .trim()
    .max(5000)
    .regex(...TEXT_RULES.free)
    .optional(),
  priority: z.enum(TASK_PRIORITIES),
  start_at: optionalDate,
  due_at: optionalDate,
})

export function validateDates(
  value: { start_at?: string; due_at?: string | null },
  ctx: z.RefinementCtx
) {
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
    validateDates({ ...value, start_at: value.start_at ?? new Date().toISOString() }, ctx)
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
export const CancelTaskSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .regex(...TEXT_RULES.free),
})
export const ForceCompleteTaskSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .regex(...TEXT_RULES.free),
})

export const TaskAssignmentOptionsQuerySchema = z
  .object({
    office_id: z.uuid().optional(),
    office_ids: z.array(z.uuid()).min(1).max(500).optional(),
    task_id: z.uuid().optional(),
    reference_type: z.enum(TASK_REFERENCE_COLLECTIONS).optional(),
    reference_id: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.reference_type) !== Boolean(value.reference_id))
      ctx.addIssue({
        code: 'custom',
        path: ['reference_id'],
        message: 'La referencia debe estar completa.',
      })
    if (value.task_id && (value.office_id || value.office_ids || value.reference_type))
      ctx.addIssue({ code: 'custom', path: ['task_id'], message: 'El alcance lo define la tarea.' })
    if (
      value.office_id &&
      value.office_ids &&
      (value.office_ids.length !== 1 || value.office_ids[0] !== value.office_id)
    )
      ctx.addIssue({ code: 'custom', path: ['office_ids'], message: 'Los alcances no coinciden.' })
  })

export const TASK_EFFECTIVE_STATUSES = [
  'planned',
  'pending',
  'in_progress',
  'completed',
  'cancelled',
] as const

const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    value => (typeof value === 'string' && value ? value.split(',') : undefined),
    z.array(z.enum(values)).min(1).max(values.length).optional()
  )

export const TaskListQuerySchema = z.object({
  view: z.enum(['mine', 'pool', 'all']).default('mine'),
  // Uno o varios valores separados por coma (`planned,pending`); ausente = todos.
  status: commaList(TASK_EFFECTIVE_STATUSES),
  priority: commaList(TASK_PRIORITIES),
  office_id: z.string().min(1).optional(),
  include_archived: z.coerce.boolean().default(false),
})

export type CreateTasksInput = z.infer<typeof CreateTasksSchema>
export type EditTaskInput = z.infer<typeof EditTaskSchema>
export type ReassignTaskInput = z.infer<typeof ReassignTaskSchema>
export type TaskReferenceInput = z.infer<typeof TaskReferenceSchema>
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>
