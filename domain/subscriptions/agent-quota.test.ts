import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateAgentLimit } from './agent-quota'

test('basic allows one agent per existing office', () => {
  assert.equal(calculateAgentLimit('basic', 4, 2), 2)
})

test('premium allows two agents per existing office', () => {
  assert.equal(calculateAgentLimit('premium', 99, 3), 6)
  assert.equal(calculateAgentLimit('premium', null, 0), 0)
})
