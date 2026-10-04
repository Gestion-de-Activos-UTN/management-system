import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CreateTasksSchema, EditTaskSchema } from './schema'

const base = {
  title: 'Revisar servidor',
  description: '',
  priority: 'normal' as const,
  global: true,
  office_ids: [],
  assignment_kind: 'open_pool' as const,
}

test('acepta una tarea global sin oficina', () => {
  assert.equal(CreateTasksSchema.safeParse(base).success, true)
})

test('una tarea no global exige al menos una oficina y no acepta duplicadas', () => {
  assert.equal(CreateTasksSchema.safeParse({ ...base, global: false }).success, false)
  assert.equal(
    CreateTasksSchema.safeParse({ ...base, global: false, office_ids: ['a', 'a'] }).success,
    false
  )
})

test('los campos de asignación son condicionales', () => {
  assert.equal(CreateTasksSchema.safeParse({ ...base, assignment_kind: 'role' }).success, false)
  assert.equal(
    CreateTasksSchema.safeParse({ ...base, assignment_kind: 'role', assigned_role: 'role-1' })
      .success,
    true
  )
  assert.equal(CreateTasksSchema.safeParse({ ...base, assigned_user: 'user-1' }).success, false)
})

test('el vencimiento no puede preceder al inicio', () => {
  const result = CreateTasksSchema.safeParse({
    ...base,
    start_at: '2026-10-03T12:00:00.000Z',
    due_at: '2026-10-02T12:00:00.000Z',
  })
  assert.equal(result.success, false)
})

test('aplica límites de título y descripción', () => {
  assert.equal(CreateTasksSchema.safeParse({ ...base, title: 'ab' }).success, false)
  assert.equal(
    CreateTasksSchema.safeParse({ ...base, description: 'x'.repeat(5001) }).success,
    false
  )
})

test('la edición permite quitar el vencimiento', () => {
  assert.deepEqual(EditTaskSchema.parse({ due_at: null }), { due_at: null })
})
