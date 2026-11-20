import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnswerEvidence } from './answer-evidence'
import { bandVisible, calculateDeficiencyIndex, indexVisible } from './deficiency-index'
import { buildDeficiencyPairs, type RiskInputAsset } from './deficiency-pairs'
import { evaluationFromPairs } from './evaluation-from-pairs'
import { contributionFromPair } from './persistRiskEvaluation'

const asset = (overrides: Partial<RiskInputAsset>): RiskInputAsset => ({
  key: 'manual:a',
  source: 'manual',
  office_id: 'o1',
  risk_type: 'workstation',
  criticality: 'low',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr: null,
  excluded: false,
  observation: null,
  ...overrides,
})

// An organization declaration (A.5.15 is organization-scoped): every asset inherits it.
const answer = (overrides: Partial<AnswerEvidence>): AnswerEvidence => ({
  control_key: 'A.5.15',
  origin: 'organization',
  asset_key: null,
  office_id: null,
  applicability: 'applicable',
  compliance: 0,
  sub: [{ question_key: 'A.5.15.access_revocation', option_key: 'no', base: 0, adjusted: 0, answered_at: null }],
  applied_rules: [],
  assessment_id: 'a-1',
  result_id: 'r-1',
  completed_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

const evaluate = (assets: RiskInputAsset[], answers: AnswerEvidence[] = []) => {
  const built = buildDeficiencyPairs({ organizationId: 'org', policy: 'essential', assets, answers, monitoring: [] })
  return { ...built, evaluation: evaluationFromPairs({ policy: 'essential', ...built }) }
}

describe('evaluationFromPairs', () => {
  it('counts index pairs only, keeps asset dimensions apart and a shared deficiency once', () => {
    const { pairs, evaluation } = evaluate(
      [
        asset({ key: 'manual:a' }),
        asset({ key: 'manual:b', criticality: 'critical' }),
        asset({ key: 'asset:c', source: 'network', identified: false, authorization_status: 'pending', risk_type: null }),
      ],
      [answer({})]
    )
    const indexPairs = pairs.filter(pair => !['A.5.9', 'A.5.12', 'A.8.16'].includes(pair.control_key))
    assert.equal(
      Object.values(evaluation.counts.pairs).reduce((sum, value) => sum + value, 0),
      indexPairs.length
    )
    assert.equal(evaluation.counts.assets.in_scope, 3)
    assert.equal(evaluation.counts.assets.unidentified, 1)
    assert.equal(evaluation.counts.assets.authorization_pending, 1)
    // One organization answer reaching two assets is one deficiency, not two.
    const revocation = pairs.filter(
      pair => pair.control_key === 'A.5.15' && pair.reasons.some(reason => reason.list === 'deficiency')
    )
    assert.equal(revocation.length, 2)
    assert.deepEqual(evaluation.counts.deficiencies, { low: 0, medium: 0, high: 1, critical: 0 })
  })

  it('calculates each asset index over its own pairs, never by averaging', () => {
    const { pairs, evaluation } = evaluate([asset({ key: 'manual:a' }), asset({ key: 'manual:b' })], [answer({})])
    for (const item of evaluation.asset_summary) {
      const own = calculateDeficiencyIndex(pairs.filter(pair => pair.asset_key === item.asset_key))
      assert.deepEqual(
        { index: item.index, coverage: item.coverage, visibility: item.visibility, band: item.band },
        { index: own.index, coverage: own.coverage, visibility: own.visibility, band: own.band }
      )
    }
    assert.deepEqual(evaluation.asset_summary.map(item => item.asset_key), ['manual:a', 'manual:b'])
    assert.deepEqual(
      evaluation.warnings.map(item => item.control_key),
      evaluation.control_summary.filter(control => control.warning).map(control => control.control_key)
    )
  })

  it('is undetermined with no pairs at all', () => {
    const { evaluation } = evaluate([])
    assert.equal(evaluation.visibility, 'undetermined')
    assert.equal(evaluation.index, null)
    assert.equal(evaluation.engine_version, 3)
  })
})

describe('contributionFromPair', () => {
  it('splits the asset key and weighs by criticality only', () => {
    const { pairs } = evaluate([asset({ key: 'manual:m1', criticality: 'critical' })], [answer({})])
    const row = contributionFromPair(pairs.find(pair => pair.control_key === 'A.5.15')!)
    assert.deepEqual(
      [row.asset, row.manual_asset, row.asset_office, row.criticality_weight, row.status, row.priority],
      [null, 'm1', 'o1', 8, 'non_compliant', 'high']
    )
  })
})

describe('index visibility rule', () => {
  it('shows the index from preliminary and the band only when banded', () => {
    assert.deepEqual(
      (['undetermined', 'hidden', 'preliminary', 'banded', null, undefined] as const).map(v => [indexVisible(v), bandVisible(v)]),
      [[false, false], [false, false], [true, false], [true, true], [false, false], [false, false]]
    )
  })
})
