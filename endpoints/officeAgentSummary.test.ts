import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getOfficeScannerStatus, type OfficeAgentSummary } from './officeAgentSummary'

const summary = (overrides: Partial<OfficeAgentSummary> = {}): OfficeAgentSummary => ({
  office_id: 'office-1',
  total: 0,
  active: 0,
  online: 0,
  offline: 0,
  never_connected: 0,
  ...overrides,
})

describe('getOfficeScannerStatus', () => {
  it('reports not installed when there are no agents', () => {
    assert.equal(getOfficeScannerStatus(summary()), 'not_installed')
  })

  it('reports pending when the active agent has never connected', () => {
    assert.equal(
      getOfficeScannerStatus(summary({ total: 1, active: 1, never_connected: 1 })),
      'pending'
    )
  })

  it('reports offline only after an agent has connected', () => {
    assert.equal(getOfficeScannerStatus(summary({ total: 1, active: 1, offline: 1 })), 'offline')
  })

  it('prioritizes online when at least one active agent is connected', () => {
    assert.equal(
      getOfficeScannerStatus(summary({ total: 2, active: 2, online: 1, never_connected: 1 })),
      'online'
    )
  })
})
