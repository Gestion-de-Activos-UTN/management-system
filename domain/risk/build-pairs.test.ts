import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRiskPairs, type RiskAnswerEvidence, type RiskInputAsset } from './build-pairs'
import { calculateRisk } from './engine'

const asset = (overrides: Partial<RiskInputAsset> = {}): RiskInputAsset => ({
  key: 'asset:1',
  source: 'network',
  office_id: 'o1',
  risk_type: 'workstation',
  criticality: 'medium',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr: '10.0.0.0/24',
  excluded: false,
  network: { current: true, complete: true, services: [] },
  ...overrides,
})

const answer = (overrides: Partial<RiskAnswerEvidence>): RiskAnswerEvidence => ({
  control_key: 'A.8.13',
  asset_key: null,
  office_id: null,
  efficacy: 1,
  evaluated_at: '2026-09-01T00:00:00.000Z',
  reason_code: 'fixture',
  ...overrides,
})

const build = (assets: RiskInputAsset[], answers: RiskAnswerEvidence[] = []) =>
  buildRiskPairs({
    organizationId: 'org',
    policy: 'essential',
    assets,
    answers,
    monitoring: [{ office_id: 'o1', efficacy: 1, reason_code: 'agent_reporting' }],
  })

const pairOf = (result: ReturnType<typeof build>, assetKey: string, control: string) =>
  result.pairs.filter(pair => pair.asset_id === assetKey && pair.control_key === control)

describe('buildRiskPairs', () => {
  it('creates applicable pairs without answers so they stay in the coverage denominator', () => {
    const result = build([asset()])
    const backup = pairOf(result, 'asset:1', 'A.8.13')
    assert.equal(backup.length, 1)
    assert.equal(backup[0].efficacy, null)
    assert.equal(backup[0].reason_code, 'answer_missing')
    assert.ok(calculateRisk(result.pairs, result.population).coverage < 100)
  })

  it('emits automatic controls once, with A.5.9/A.5.12 coverage-only', () => {
    const result = build([asset()])
    for (const control of ['A.5.9', 'A.5.12', 'A.8.16', 'A.8.20', 'A.8.21']) {
      assert.equal(pairOf(result, 'asset:1', control).length, 1, control)
    }
    assert.ok(pairOf(result, 'asset:1', 'A.5.9')[0].coverage_only)
    assert.ok(pairOf(result, 'asset:1', 'A.5.12')[0].coverage_only)
  })

  it('inherits office answers only inside that office and only for declared asset types', () => {
    const assets = [
      asset({ key: 'asset:ws', risk_type: 'workstation' }),
      asset({ key: 'asset:srv', risk_type: 'server' }),
      asset({ key: 'asset:other-office', risk_type: 'server', office_id: 'o2' }),
    ]
    const result = build(assets, [
      answer({ control_key: 'A.8.15', office_id: 'o1', efficacy: 0.6 }),
    ])
    assert.equal(pairOf(result, 'asset:ws', 'A.8.15').length, 0) // A.8.15 targets servers/network
    assert.equal(pairOf(result, 'asset:srv', 'A.8.15')[0].efficacy, 0.6)
    assert.equal(pairOf(result, 'asset:other-office', 'A.8.15')[0].efficacy, null)
    assert.equal(pairOf(result, 'asset:srv', 'A.8.15')[0].unit_kind, 'office')
  })

  it('inherits organization answers in every office and prefers the most specific answer', () => {
    const result = build(
      [asset({ key: 'asset:a' }), asset({ key: 'asset:b', office_id: 'o2' })],
      [
        answer({ control_key: 'A.5.25', efficacy: 0.4 }),
        answer({
          control_key: 'A.5.25',
          office_id: 'o2',
          efficacy: 1,
          evaluated_at: '2026-01-01T00:00:00.000Z',
        }),
      ]
    )
    assert.equal(pairOf(result, 'asset:a', 'A.5.25')[0].efficacy, 0.4)
    assert.equal(pairOf(result, 'asset:b', 'A.5.25')[0].efficacy, 1) // office beats newer org answer
    assert.equal(pairOf(result, 'asset:a', 'A.5.25')[0].unit_kind, 'organization')
  })

  it('uses the latest own answer for asset controls and never inherits them', () => {
    const result = build(
      [asset(), asset({ key: 'asset:2' })],
      [
        answer({ asset_key: 'asset:1', efficacy: 0, evaluated_at: '2026-01-01T00:00:00.000Z' }),
        answer({ asset_key: 'asset:1', efficacy: 0.5, evaluated_at: '2026-06-01T00:00:00.000Z' }),
        answer({ office_id: 'o1', efficacy: 1 }),
      ]
    )
    assert.equal(pairOf(result, 'asset:1', 'A.8.13')[0].efficacy, 0.5)
    assert.equal(pairOf(result, 'asset:2', 'A.8.13')[0].efficacy, null)
  })

  it('keeps unidentified or pending assets in the population with every pair not evaluable', () => {
    const result = build(
      [
        asset(),
        asset({
          key: 'asset:shadow',
          identified: false,
          authorization_status: 'pending',
          risk_type: null,
        }),
      ],
      [answer({ control_key: 'A.5.25', efficacy: 1 })]
    )
    const shadowPairs = result.pairs.filter(pair => pair.asset_id === 'asset:shadow')
    assert.ok(shadowPairs.length > 0)
    assert.ok(shadowPairs.every(pair => pair.efficacy === null))
    const risk = calculateRisk(result.pairs, result.population)
    assert.equal(risk.unknown_percentage, 50)
    // Sharing the CIDR with an unidentified device expands the neighbor's scope.
    assert.equal(pairOf(result, 'asset:1', 'A.8.13')[0].scope_multiplier, 1.5)
  })

  it('gives assets without a risk type (printers) only automatic controls', () => {
    const result = build(
      [asset({ key: 'asset:printer', risk_type: null })],
      [answer({ control_key: 'A.5.25' })]
    )
    assert.deepEqual(result.pairs.map(pair => pair.control_key).sort(), [
      'A.5.12',
      'A.5.9',
      'A.8.16',
      'A.8.20',
      'A.8.21',
    ])
  })

  it('applies scan exposure to human controls, X=1 to A.8.21 and the fallback to manual assets', () => {
    const exposed = asset({
      network: {
        current: true,
        complete: true,
        services: [{ classification: 'prohibited', severity: 'high' }],
      },
    })
    const manual = asset({ key: 'manual:1', source: 'manual', network: null, cidr: null })
    const result = build([exposed, manual])
    assert.equal(pairOf(result, 'asset:1', 'A.8.13')[0].exposure, 'high')
    assert.equal(pairOf(result, 'asset:1', 'A.8.21')[0].exposure, 'low')
    assert.equal(pairOf(result, 'asset:1', 'A.8.21')[0].severity, 'high')
    assert.equal(pairOf(result, 'manual:1', 'A.8.13')[0].exposure, 'medium')
    assert.equal(pairOf(result, 'manual:1', 'A.8.13')[0].exposure_source, 'default_unknown')
    assert.equal(pairOf(result, 'manual:1', 'A.8.21').length, 0)
  })

  it('excludes only human-question pairs of an excluded asset', () => {
    const result = build([asset({ excluded: true })])
    assert.equal(pairOf(result, 'asset:1', 'A.8.13')[0].excluded, true)
    assert.ok(!pairOf(result, 'asset:1', 'A.8.21')[0].excluded)
    const counts = calculateRisk(result.pairs, result.population).counts
    assert.equal(counts.excluded_assets, 1)
    assert.ok(counts.excluded > 1) // several question pairs, one asset
  })

  it('reads severity from the catalog, so a failed A.8.2 on a critical server raises an alert', () => {
    const result = build(
      [asset({ key: 'asset:srv', risk_type: 'server', criticality: 'critical' })],
      [answer({ control_key: 'A.8.2', asset_key: 'asset:srv', efficacy: 0 })]
    )
    assert.equal(pairOf(result, 'asset:srv', 'A.8.2')[0].severity, 'critical')
    assert.deepEqual(calculateRisk(result.pairs, result.population).critical_asset_alerts, [
      { asset_id: 'asset:srv', control_key: 'A.8.2' },
    ])
  })

  it('never improves coverage when an asset goes offline', () => {
    const online = build([asset()])
    const offline = build([asset({ network: { current: false, complete: true, services: [] } })])
    assert.ok(
      calculateRisk(offline.pairs, offline.population).coverage <=
        calculateRisk(online.pairs, online.population).coverage
    )
  })
})
