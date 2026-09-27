import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ASSESSMENT_EXCLUSION_MAX_DAYS,
  CONTROL_RISK_CAP,
  COVERAGE_THRESHOLDS,
  CRITICALITY_WEIGHTS,
  EXPOSURE_WEIGHTS,
  SCORE_THRESHOLDS,
  SEVERITY_WEIGHTS,
  SCOPE_MULTIPLIERS,
  UNKNOWN_THRESHOLDS,
  bandVisible,
  scoreVisible,
} from './constants'

describe('risk engine v2 constants', () => {
  it('uses the closed exponential scales', () => {
    assert.deepEqual(CRITICALITY_WEIGHTS, {
      low: 1,
      medium: 2,
      high: 4,
      critical: 8,
      unknown: 2,
    })
    assert.deepEqual(SEVERITY_WEIGHTS, {
      low: 1,
      medium: 2,
      high: 4,
      critical: 8,
      unknown: 2,
    })
    assert.deepEqual(EXPOSURE_WEIGHTS, { low: 1, medium: 2, high: 4 })
    assert.deepEqual(SCOPE_MULTIPLIERS, { local: 1, expanded: 1.5 })
  })

  it('freezes caps and boundary thresholds from the plan', () => {
    assert.equal(CONTROL_RISK_CAP, 0.3)
    assert.equal(ASSESSMENT_EXCLUSION_MAX_DAYS, 90)
    assert.deepEqual(COVERAGE_THRESHOLDS, {
      visible: 20,
      warning: 40,
      usable: 60,
      reliable: 80,
    })
    assert.deepEqual(UNKNOWN_THRESHOLDS, { warning: 5, degradeConfidence: 15 })
    assert.deepEqual(SCORE_THRESHOLDS, { medium: 25, high: 50, critical: 75 })
  })

  it('hides the score below the visible threshold and the band while preliminary', () => {
    assert.equal(scoreVisible('hidden'), false)
    assert.equal(scoreVisible('preliminary'), true)
    assert.equal(bandVisible('preliminary'), false)
    for (const confidence of ['warning', 'usable', 'reliable'] as const) {
      assert.equal(scoreVisible(confidence), true)
      assert.equal(bandVisible(confidence), true)
    }
  })
})
