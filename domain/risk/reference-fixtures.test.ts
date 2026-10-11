import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRiskPairs, type RiskAnswerEvidence, type RiskInputAsset } from './build-pairs'
import { calculateRisk } from './engine'

/**
 * Reference fixtures calculated by hand from Reglas-Globales-Motor-Riesgo.md and plan §3.
 * If one of these numbers changes, the model changed: update the hand calculation first.
 *
 * Office o1, agent reporting (A.8.16 E=1). Policy: essential.
 *   S1 server, critical (C=8), scan complete, one expected low-severity service → X=1
 *   W1 workstation, medium (C=2), scan complete, no open ports → X=1
 * Answers: S1 A.8.2 = 0 (generic password). W1 A.8.13 = 0.5 (local disk + periodic copy).
 */
const cidr = '10.0.0.0/24'
const S1: RiskInputAsset = {
  key: 'asset:S1',
  source: 'network',
  office_id: 'o1',
  risk_type: 'server',
  criticality: 'critical',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr,
  excluded: false,
  network: {
    current: true,
    complete: true,
    services: [{ classification: 'expected', severity: 'low' }],
  },
}
const W1: RiskInputAsset = {
  ...S1,
  key: 'asset:W1',
  risk_type: 'workstation',
  criticality: 'medium',
  network: { current: true, complete: true, services: [] },
}
const answers: RiskAnswerEvidence[] = [
  {
    control_key: 'A.8.2',
    asset_key: 'asset:S1',
    office_id: 'o1',
    efficacy: 0,
    evaluated_at: '2026-09-01T00:00:00.000Z',
    reason_code: 'fixture',
  },
  {
    control_key: 'A.8.13',
    asset_key: 'asset:W1',
    office_id: 'o1',
    efficacy: 0.5,
    evaluated_at: '2026-09-01T00:00:00.000Z',
    reason_code: 'fixture',
  },
]

const run = (assets: RiskInputAsset[]) => {
  const built = buildRiskPairs({
    organizationId: 'org',
    policy: 'essential',
    assets,
    answers,
    monitoring: [{ office_id: 'o1', efficacy: 1, reason_code: 'agent_reporting' }],
  })
  return { ...built, risk: calculateRisk(built.pairs, built.population) }
}

const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

describe('reference fixture 1: segmented office', () => {
  /*
   * Evaluable risk pairs, RI = C × A × S × X (A=1, X=1):
   *   S1 A.8.20 8×4=32 (RR 0) · A.8.21 8×1=8 (RR 0, S=low rule) · A.8.16 8×4=32 (RR 0)
   *   S1 A.8.2  8×8=64 (RR 64)
   *   W1 A.8.20 2×4=8  (RR 0) · A.8.21 2×2=4 (RR 0, no rule → unknown=2) · A.8.16 2×4=8 (RR 0)
   *   W1 A.8.13 2×4=8  (RR 4)
   * RIEM = 164 · RRO_raw = 68 · cap = 0.30 × 164 = 49.2
   * A.8.2 64 → capped 49.2 · A.8.13 4 → RRO_adjusted = 53.2
   * Score = 53.2 / 164 × 100 = 32.4390…% → Medio; 100% of RR is high/critical (> 30%) → Alto
   *
   * Coverage, W = C per applicable pair (essential policy):
   *   S1: 5 automatic + 9 question controls (A.5.15, A.5.25, A.8.2, A.8.5, A.8.7, A.8.13, A.8.15,
   *       A.8.19, A.8.22) = 14 × 8 = 112; evaluable 5 automatic + A.8.2 = 6 × 8 = 48
   *   W1: 5 automatic + 9 (A.5.15, A.5.25, A.7.9, A.8.1, A.8.5, A.8.7, A.8.13, A.8.19, A.8.22)
   *       = 14 × 2 = 28; evaluable 5 + A.8.13 = 6 × 2 = 12
   *   Coverage = 60 / 140 = 42.857…% → warning
   * Per asset: S1 64 / 136 = 47.06% (Medio) · W1 4 / 28 = 14.29% (Bajo)
   */
  const { risk } = run([S1, W1])

  it('matches RIEM, RRO, cap and score', () => {
    close(risk.riem, 164)
    close(risk.rro_raw, 68)
    close(risk.controls.find(c => c.control_key === 'A.8.2')!.residual_capped, 49.2)
    close(risk.rro_adjusted, 53.2)
    close(risk.score, (53.2 / 164) * 100)
    assert.equal(risk.base_band, 'medium')
    assert.equal(risk.final_band, 'high')
    assert.equal(risk.severe_concentration, true)
  })

  it('matches coverage, confidence and per-asset scores', () => {
    close(risk.coverage, (60 / 140) * 100)
    assert.equal(risk.confidence, 'warning')
    assert.equal(risk.effective_confidence, 'warning')
    close(risk.unknown_percentage, 0)
    const s1 = risk.assets.find(a => a.asset_id === 'asset:S1')!
    const w1 = risk.assets.find(a => a.asset_id === 'asset:W1')!
    close(s1.score, (64 / 136) * 100)
    assert.equal(s1.band, 'medium')
    close(w1.score, (4 / 28) * 100)
    assert.equal(w1.band, 'low')
  })

  it('matches alerts and counts', () => {
    assert.deepEqual(risk.critical_asset_alerts, [{ asset_id: 'asset:S1', control_key: 'A.8.2' }])
    // A.8.2 applies only to S1 and it fails → 100% > 20%. A.8.13 is partially effective only.
    assert.equal(risk.controls.find(c => c.control_key === 'A.8.2')!.systemic_failure, true)
    assert.equal(risk.controls.find(c => c.control_key === 'A.8.13')!.systemic_failure, false)
    assert.deepEqual(risk.counts, {
      compliant: 10,
      partially_effective: 1,
      non_compliant: 1,
      not_evaluable: 16,
      excluded: 0,
      excluded_assets: 0,
      unconfirmed_assets: 0,
    })
  })
})

describe('reference fixture 2: same office plus one unidentified device in the same CIDR', () => {
  /*
   * U1 unidentified, pending, unknown criticality (C=2), no risk type → 5 automatic pairs, all
   * not evaluable (weight 5 × 2 = 10).
   * S1 and W1 now share a CIDR with an unidentified device → A = 1.5 on every pair:
   *   RIEM = 164 × 1.5 = 246 · RRO_raw = 102 · cap = 73.8 · A.8.2 96 → 73.8 · A.8.13 6
   *   RRO_adjusted = 79.8 · Score = 79.8 / 246 = 32.4390…% (same: A scales both terms)
   * Coverage = 60 / 150 = 40% → warning; Unknown = 2 / 12 = 16.67% ≥ 15 → confidence preliminary
   * S1 is critical and shares the CIDR → "Exposición no determinada" alert.
   */
  const U1: RiskInputAsset = {
    ...W1,
    key: 'asset:U1',
    risk_type: null,
    criticality: 'unknown',
    identified: false,
    authorization_status: 'pending',
    has_owner: false,
  }
  const { risk, alerts } = run([S1, W1, U1])

  it('amplifies RI and RR by the scope multiplier without changing the score', () => {
    close(risk.riem, 246)
    close(risk.rro_raw, 102)
    close(risk.rro_adjusted, 79.8)
    close(risk.score, (79.8 / 246) * 100)
  })

  it('keeps the unidentified device in coverage and degrades confidence', () => {
    close(risk.coverage, 40)
    assert.equal(risk.confidence, 'warning')
    close(risk.unknown_percentage, (2 / 12) * 100)
    assert.equal(risk.effective_confidence, 'preliminary')
    assert.equal(risk.counts.unconfirmed_assets, 1)
  })

  it('raises the undetermined exposure alert only for the critical neighbor', () => {
    assert.deepEqual(alerts, [{ asset_id: 'asset:S1', cidr, type: 'undetermined_exposure' }])
  })
})
