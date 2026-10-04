import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultTaskStartAt } from './index'

test('el hook completa start_at e initial_due_at al crear', async () => {
  const due = '2026-10-10T12:00:00.000Z'
  const result = await defaultTaskStartAt({
    operation: 'create',
    data: { due_at: due },
  } as never)
  assert.ok(result?.start_at)
  assert.equal(result?.initial_due_at, due)
})

test('el hook conserva start_at explícito', async () => {
  const start = '2026-10-02T12:00:00.000Z'
  const result = await defaultTaskStartAt({
    operation: 'create',
    data: { start_at: start },
  } as never)
  assert.equal(result?.start_at, start)
})
