import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldTakeSnapshot } from './autoSnapshot'

test('shouldTakeSnapshot: sin snapshot previo, siempre dispara', () => {
  assert.equal(shouldTakeSnapshot(null, 7, Date.now()), true)
})

test('shouldTakeSnapshot: dentro del intervalo, no dispara', () => {
  const now = Date.now()
  const takenAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() // hace 2 días
  assert.equal(shouldTakeSnapshot(takenAt, 7, now), false)
})

test('shouldTakeSnapshot: intervalo cumplido, dispara', () => {
  const now = Date.now()
  const takenAt = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString() // hace 8 días
  assert.equal(shouldTakeSnapshot(takenAt, 7, now), true)
})
