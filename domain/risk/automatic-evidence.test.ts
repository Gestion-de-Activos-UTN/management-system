import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateNetworkServices,
  exposureFromServices,
  scopeMultiplier,
  shadowItEfficacy,
} from './automatic-evidence'

test('A.8.21 prohibited dominates review and always uses its own severity', () => {
  const result = evaluateNetworkServices({
    current: true,
    complete: true,
    services: [
      { classification: 'review' },
      { classification: 'prohibited', severity: 'critical' },
    ],
  })
  assert.deepEqual(result, { efficacy: 0, severity: 'critical', reason_code: 'network_prohibited' })
})

test('unmatched service is not evaluable for A.8.21 but low exposure elsewhere', () => {
  const services = [{ classification: 'unmatched' as const }]
  assert.equal(evaluateNetworkServices({ current: true, complete: true, services }).efficacy, null)
  assert.deepEqual(exposureFromServices({ current: true, complete: true, services }), {
    exposure: 'low',
    source: 'scan',
  })
})

test('incomplete evidence uses exposure fallback and CIDR only expands known neighbors', () => {
  assert.deepEqual(exposureFromServices({ current: false, complete: false, services: [] }), {
    exposure: 'medium',
    source: 'default_unknown',
  })
  assert.equal(scopeMultiplier('10.0.0.0/24', new Set(['10.0.0.0/24'])), 1.5)
  assert.equal(scopeMultiplier(null, new Set(['10.0.0.0/24'])), 1)
  assert.equal(shadowItEfficacy(true, 'unauthorized'), 0)
})
