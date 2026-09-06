import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateAgentLimit } from './agent-quota'

test('basic allows one agent per existing office', () => {
  assert.equal(calculateAgentLimit('basic', 2), 2)
})

test('premium allows two agents per existing office', () => {
  assert.equal(calculateAgentLimit('premium', 3), 6)
  assert.equal(calculateAgentLimit('premium', 0), 0)
})
