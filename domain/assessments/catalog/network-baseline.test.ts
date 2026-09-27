import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NETWORK_BASELINE, validateNetworkBaseline } from '.'

describe('network baseline', () => {
  it('accepts the deployed rules', () => {
    assert.doesNotThrow(() => validateNetworkBaseline(NETWORK_BASELINE))
  })

  it('rejects duplicated keys, foreign controls and invalid ports', () => {
    const rule = NETWORK_BASELINE[0]
    assert.throws(() => validateNetworkBaseline([rule, rule]), /duplicated/)
    assert.throws(() => validateNetworkBaseline([{ ...rule, control_key: 'A.8.20' }]), /A\.8\.21/)
    assert.throws(() => validateNetworkBaseline([{ ...rule, ports: [70000] }]), /invalid ports/)
  })
})
