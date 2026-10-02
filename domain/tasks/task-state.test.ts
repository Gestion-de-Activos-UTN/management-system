import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertTaskCanStart,
  effectiveTaskStatus,
  isTaskOverdue,
  wasTaskCompletedLate,
} from './task-state'

const now = new Date('2026-10-02T15:00:00.000Z')

test('pending con inicio futuro se presenta como planned', () => {
  assert.equal(
    effectiveTaskStatus({ status: 'pending', start_at: '2026-10-03T15:00:00.000Z' }, now),
    'planned'
  )
})

test('pending queda disponible al alcanzar su inicio', () => {
  assert.equal(
    effectiveTaskStatus({ status: 'pending', start_at: '2026-10-02T15:00:00.000Z' }, now),
    'pending'
  )
})

test('el vencimiento no altera el estado ni impide identificarla como vencida', () => {
  const task = {
    status: 'pending',
    start_at: '2026-10-01T15:00:00.000Z',
    due_at: '2026-10-02T14:00:00.000Z',
  }
  assert.equal(effectiveTaskStatus(task, now), 'pending')
  assert.equal(isTaskOverdue(task, now), true)
  assert.doesNotThrow(() => assertTaskCanStart(task, now))
})

test('una tarea completada tarde se deriva de completed_at y due_at', () => {
  assert.equal(
    wasTaskCompletedLate({
      status: 'completed',
      due_at: '2026-10-02T14:00:00.000Z',
      completed_at: '2026-10-02T15:00:00.000Z',
    }),
    true
  )
})
