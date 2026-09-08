import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateNetworkBaseline } from './evaluateNetworkBaseline'

const coverage = { port_coverage: 'complete' as const, service_coverage: 'complete' as const }

describe('secure network baseline', () => {
  it('marks confirmed Telnet as prohibited without asking a person', () => {
    const [result] = evaluateNetworkBaseline({
      ...coverage,
      confirmed_type: 'gateway',
      services: [{ port: 23, protocol: 'tcp', state: 'open', confidence: 10 }],
    })
    assert.equal(result.status, 'non_compliant')
    assert.equal(result.reason_code, 'network_prohibited')
  })

  it('keeps remote access and ambiguous services not evaluable', () => {
    const results = evaluateNetworkBaseline({
      ...coverage,
      confirmed_type: 'workstation',
      services: [
        { port: 3389, protocol: 'tcp', state: 'open', confidence: 9 },
        { port: 9999, protocol: 'tcp', state: 'open', confidence: 10 },
      ],
    })
    assert.deepEqual(
      results.map(result => result.status),
      ['not_evaluable', 'not_evaluable']
    )
  })

  it('never reports non-compliance with partial coverage or low confidence', () => {
    const partial = evaluateNetworkBaseline({
      confirmed_type: 'gateway',
      port_coverage: 'partial',
      service_coverage: 'complete',
      services: [{ port: 23, protocol: 'tcp', state: 'open', confidence: 10 }],
    })
    const uncertain = evaluateNetworkBaseline({
      ...coverage,
      confirmed_type: 'gateway',
      services: [{ port: 23, protocol: 'tcp', state: 'open', confidence: 4 }],
    })
    assert.equal(partial[0].status, 'not_evaluable')
    assert.equal(uncertain[0].status, 'not_evaluable')
  })

  it('accepts DNS only as an expected function of a confirmed gateway', () => {
    const gateway = evaluateNetworkBaseline({
      ...coverage,
      confirmed_type: 'gateway',
      services: [{ port: 53, protocol: 'udp', state: 'open', confidence: 9 }],
    })
    const workstation = evaluateNetworkBaseline({
      ...coverage,
      confirmed_type: 'workstation',
      services: [{ port: 53, protocol: 'udp', state: 'open', confidence: 9 }],
    })
    assert.equal(gateway[0].status, 'compliant')
    assert.equal(workstation[0].status, 'not_evaluable')
  })
})
