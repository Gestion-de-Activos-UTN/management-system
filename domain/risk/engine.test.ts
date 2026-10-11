import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateRisk, confidenceForCoverage, degradeConfidence, riskBandForScore } from './engine'
import type { ApplicableRiskPair, RiskPopulationAsset } from './engine'

const population: RiskPopulationAsset[] = [
  { asset_id: 'a1', criticality: 'high', identified: true, authorization_status: 'authorized' },
]

const pair = (overrides: Partial<ApplicableRiskPair> = {}): ApplicableRiskPair => ({
  asset_id: 'a1',
  control_key: 'A.8.7',
  criticality: 'high',
  severity: 'high',
  exposure: 'low',
  scope_multiplier: 1,
  efficacy: 0,
  reason_code: 'fixture',
  unit_kind: 'asset',
  unit_id: 'a1',
  ...overrides,
})

describe('risk engine v2', () => {
  it('calculates RI, RR and score without intermediate rounding', () => {
    const result = calculateRisk([pair({ efficacy: 0.25 })], population)
    assert.equal(result.riem, 16)
    assert.equal(result.rro_raw, 12)
    assert.equal(result.rro_adjusted, 4.8)
    assert.equal(result.score, 30)
    assert.equal(result.assets[0].score, 75)
  })

  it('keeps not evaluable pairs out of RIEM but in coverage', () => {
    const result = calculateRisk(
      [pair(), pair({ control_key: 'A.8.13', efficacy: null })],
      population
    )
    assert.equal(result.riem, 16)
    assert.equal(result.coverage, 50)
  })

  it('coverage-only controls never add inherent or residual risk', () => {
    const result = calculateRisk([pair({ control_key: 'A.5.9', coverage_only: true })], population)
    assert.equal(result.riem, 0)
    assert.equal(result.score, null)
    assert.equal(result.coverage, 100)
  })

  it('applies a cap per control and keeps raw values', () => {
    const result = calculateRisk(
      [pair(), pair({ asset_id: 'a2', unit_id: 'a2' }), pair({ control_key: 'A.8.13' })],
      [...population, { ...population[0], asset_id: 'a2' }]
    )
    const malware = result.controls.find(item => item.control_key === 'A.8.7')!
    assert.equal(malware.residual_raw, 32)
    assert.equal(malware.residual_capped, 14.399999999999999)
    assert.equal(malware.capped, true)
  })

  it('uses exact semi-open boundaries', () => {
    assert.equal(confidenceForCoverage(19.999), 'hidden')
    assert.equal(confidenceForCoverage(20), 'preliminary')
    assert.equal(confidenceForCoverage(40), 'warning')
    assert.equal(confidenceForCoverage(60), 'usable')
    assert.equal(confidenceForCoverage(80), 'reliable')
    assert.equal(riskBandForScore(24.999), 'low')
    assert.equal(riskBandForScore(25), 'medium')
    assert.equal(riskBandForScore(50), 'high')
    assert.equal(riskBandForScore(75), 'critical')
  })

  it('degrades confidence only at 15 percent and never changes hidden visibility', () => {
    assert.equal(degradeConfidence('reliable', 14.999), 'reliable')
    assert.equal(degradeConfidence('reliable', 15), 'usable')
    assert.equal(degradeConfidence('preliminary', 100), 'preliminary')
    assert.equal(degradeConfidence('hidden', 100), 'hidden')
  })

  it('calculates unknown from unidentified, pending and unauthorized assets', () => {
    const result = calculateRisk(
      [],
      [
        { asset_id: 'a', criticality: 'low', identified: true, authorization_status: 'authorized' },
        {
          asset_id: 'b',
          criticality: 'medium',
          identified: false,
          authorization_status: 'pending',
        },
        {
          asset_id: 'c',
          criticality: 'low',
          identified: true,
          authorization_status: 'unauthorized',
        },
      ]
    )
    assert.equal(result.unknown_percentage, 75)
  })

  it('does not divide by zero when there is no residual risk', () => {
    const result = calculateRisk([pair({ efficacy: 1 })], population)
    assert.equal(result.rro_raw, 0)
    assert.equal(result.severe_concentration_percentage, 0)
    assert.equal(result.severe_concentration, false)
  })

  it('detects critical alerts and systemic failures with strict thresholds', () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      pair({
        asset_id: `a${index}`,
        unit_id: `a${index}`,
        control_key: 'A.8.2',
        severity: 'critical',
        criticality: index === 0 ? 'high' : 'low',
        efficacy: index === 0 ? 0 : 1,
      })
    )
    const exactlyTwenty = calculateRisk(rows, population)
    assert.equal(exactlyTwenty.controls[0].systemic_failure, false)
    const overTwenty = calculateRisk([...rows, { ...rows[1], efficacy: 0 }], population)
    assert.equal(overTwenty.controls[0].systemic_failure, true)
    assert.deepEqual(exactlyTwenty.critical_asset_alerts, [
      { asset_id: 'a0', control_key: 'A.8.2' },
    ])
  })

  it('counts not evaluable units in the systemic failure denominator', () => {
    const failing = pair({ asset_id: 'a0', unit_id: 'a0', efficacy: 0 })
    const unknown = Array.from({ length: 4 }, (_, index) =>
      pair({ asset_id: `u${index}`, unit_id: `u${index}`, efficacy: null })
    )
    // 1 failing of 5 applicable = 20% → not systemic, although it is 100% of evaluable units.
    assert.equal(
      calculateRisk([failing, ...unknown], population).controls[0].systemic_failure,
      false
    )
  })

  it('treats one failing organization answer as systemic', () => {
    const rows = ['a0', 'a1'].map(id =>
      pair({
        asset_id: id,
        unit_kind: 'organization',
        unit_id: 'org',
        control_key: 'A.5.15',
        efficacy: 0,
      })
    )
    assert.equal(calculateRisk(rows, population).controls[0].systemic_failure, true)
  })
})
