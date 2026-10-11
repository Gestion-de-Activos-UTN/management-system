import { afterEach, expect, it, vi } from 'vitest'
import { CreateTasksSchema, EditTaskSchema, TaskAssignmentOptionsQuerySchema } from './schema'

const base = {
  title: 'Review server',
  priority: 'normal',
  global: true,
  office_ids: [],
  assignment_kind: 'open_pool',
}
afterEach(() => vi.useRealTimers())
it('VAL-02: rejects due before the implicit start, allowing ordered past dates', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
  expect(CreateTasksSchema.safeParse({ ...base, due_at: '2026-10-09T23:59:59Z' }).success).toBe(
    false
  )
  expect(
    CreateTasksSchema.safeParse({
      ...base,
      start_at: '2026-10-08T00:00:00Z',
      due_at: '2026-10-09T23:59:59Z',
    }).success
  ).toBe(true)
  expect(CreateTasksSchema.safeParse({ ...base, due_at: '2026-10-10T23:59:59Z' }).success).toBe(
    true
  )
  expect(EditTaskSchema.safeParse({ title: 'Updated title' }).success).toBe(true)
  expect(EditTaskSchema.parse({ due_at: null })).toEqual({ due_at: null })
})

it('SEC-27: assignment query rejects malformed IDs, partial references and conflicting scope', () => {
  const a = '00000000-0000-4000-8000-000000000001',
    b = '00000000-0000-4000-8000-000000000002'
  expect(TaskAssignmentOptionsQuerySchema.safeParse({ office_id: 'invalid' }).success).toBe(false)
  expect(TaskAssignmentOptionsQuerySchema.safeParse({ office_ids: [] }).success).toBe(false)
  expect(
    TaskAssignmentOptionsQuerySchema.safeParse({ office_id: a, office_ids: [b] }).success
  ).toBe(false)
  expect(TaskAssignmentOptionsQuerySchema.safeParse({ task_id: a, office_ids: [a] }).success).toBe(
    false
  )
  expect(TaskAssignmentOptionsQuerySchema.safeParse({ reference_type: 'assets' }).success).toBe(
    false
  )
  expect(
    TaskAssignmentOptionsQuerySchema.safeParse({ office_id: a, office_ids: [a] }).success
  ).toBe(true)
})
