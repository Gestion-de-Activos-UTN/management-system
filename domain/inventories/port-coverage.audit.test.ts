import { expect, it } from 'vitest'
import { portWasCovered } from './port-coverage'
import { evaluateNetworkBaseline } from '@/domain/assessments/evaluateNetworkBaseline'
it('requires confirmed range coverage before treating absence as resolution', () => {
  const ranges = [{ protocol: 'tcp', status: 'complete', port_spec: '1-1000,8443' }]
  expect(portWasCovered(ranges, 'tcp:23')).toBe(true)
  expect(portWasCovered(ranges, 'tcp:8443')).toBe(true)
  expect(portWasCovered(ranges, 'tcp:9000')).toBe(false)
  expect(portWasCovered(ranges, 'udp:23')).toBe(false)
  expect(portWasCovered([{ ...ranges[0], status: 'partial' }], 'tcp:23')).toBe(false)
  expect(portWasCovered(undefined, 'tcp:23')).toBe(false)
  // Row partial by another host's timeout: covered only for an asset whose own scan finished.
  expect(portWasCovered([{ ...ranges[0], status: 'partial' }], 'tcp:23', true)).toBe(true)
  expect(portWasCovered([{ ...ranges[0], status: 'not_attempted' }], 'tcp:23', true)).toBe(false)
})
it('filtered and ambiguous states remain unknown even when the scan claims complete coverage', () => {
  for (const state of ['filtered', 'open|filtered', 'closed|filtered', 'unfiltered', 'unknown']) {
    const result = evaluateNetworkBaseline({ confirmed_type: 'server', port_coverage: 'complete', service_coverage: 'complete', services: [{ port: 23, protocol: 'tcp', state }] })
    expect(result[0]).toMatchObject({ status: 'not_evaluable', reason_code: 'service_state_unconfirmed' })
  }
})
