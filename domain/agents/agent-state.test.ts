import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertAgentTransition,
  countsTowardAgentLimit,
  getAgentLifecycleStatus,
  isAgentOnline,
} from './agent-state'

describe('agent state machine', () => {
  it('derives provisioned, active and revoked while preserving legacy is_active', () => {
    assert.equal(getAgentLifecycleStatus({ is_active: true }), 'provisioned')
    assert.equal(
      getAgentLifecycleStatus({ is_active: true, last_heartbeat_at: '2026-01-01T00:00:00Z' }),
      'active'
    )
    assert.equal(
      getAgentLifecycleStatus({ is_active: false, lifecycle_status: 'active' }),
      'revoked'
    )
  })

  it('allows only provisioned -> active/revoked and active -> revoked', () => {
    assert.doesNotThrow(() => assertAgentTransition('provisioned', 'active'))
    assert.doesNotThrow(() => assertAgentTransition('active', 'revoked'))
    assert.throws(() => assertAgentTransition('revoked', 'active'))
    assert.throws(() => assertAgentTransition('active', 'provisioned'))
  })

  it('counts provisioned and active agents, but not revoked agents', () => {
    assert.equal(countsTowardAgentLimit({ lifecycle_status: 'provisioned' }), true)
    assert.equal(countsTowardAgentLimit({ lifecycle_status: 'active' }), true)
    assert.equal(countsTowardAgentLimit({ lifecycle_status: 'revoked' }), false)
  })

  it('rejects invalid and future heartbeat timestamps', () => {
    const now = new Date('2026-01-01T00:10:00Z')
    assert.equal(isAgentOnline({ last_heartbeat_at: '2026-01-01T00:05:00Z' }, now), true)
    assert.equal(isAgentOnline({ last_heartbeat_at: '2025-12-31T23:00:00Z' }, now), false)
    assert.equal(isAgentOnline({ last_heartbeat_at: '2026-01-01T00:11:00Z' }, now), false)
    assert.equal(isAgentOnline({ last_heartbeat_at: 'invalid' }, now), false)
  })
})
