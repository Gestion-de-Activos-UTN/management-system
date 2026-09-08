import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { POLICY_CATALOG } from './catalog'
import { computeRiskSummary, type RiskCheck } from './computeRiskSummary'

const policy = POLICY_CATALOG[0]
const check = (overrides: Partial<RiskCheck>): RiskCheck => ({
  key: Math.random().toString(),
  control_key: 'A.8.7',
  status: 'compliant',
  severity: 'medium',
  criticality: 'medium',
  ...overrides,
})

describe('risk score and assessment coverage', () => {
  it('weights the same negative result differently by asset criticality', () => {
    const low = computeRiskSummary(
      [check({ status: 'non_compliant', criticality: 'low' }), check({})],
      policy
    )
    const critical = computeRiskSummary(
      [check({ status: 'non_compliant', criticality: 'critical' }), check({})],
      policy
    )
    assert.ok(critical.risk_score! > low.risk_score!)
  })

  it('keeps not-evaluable checks out of risk while reducing coverage', () => {
    const result = computeRiskSummary(
      [check({ status: 'non_compliant' }), check({ status: 'not_evaluable' })],
      policy
    )
    assert.equal(result.risk_score, 100)
    assert.equal(result.evaluated_percentage, 50)
    assert.equal(result.not_evaluable, 1)
  })

  it('never presents an organization without evidence as protected', () => {
    const empty = computeRiskSummary([], policy)
    const unknown = computeRiskSummary([check({ status: 'not_evaluable' })], policy)
    assert.equal(empty.risk_score, null)
    assert.equal(empty.evaluated_percentage, 0)
    assert.equal(unknown.risk_score, null)
    assert.equal(unknown.evaluated_percentage, 0)
  })
})
