import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnswerEvidence } from './answer-evidence'
import type { RiskInputAsset } from './deficiency-pairs'
import { calculateDeficiencyIndex } from './deficiency-index'
import { buildDeficiencyPairs } from './deficiency-pairs'
import type { Asset } from '@/app/types/payload-types'
import { networkObservation, type NetworkHistoryRow } from './network-evidence'

const asset = (overrides: Partial<RiskInputAsset> = {}): RiskInputAsset => ({
  key: 'asset:n1',
  source: 'network',
  office_id: 'o1',
  risk_type: 'workstation',
  criticality: 'medium',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr: '10.0.0.0/24',
  excluded: false,
  observation: null,
  ...overrides,
})

const answer = (overrides: Partial<AnswerEvidence>): AnswerEvidence => ({
  control_key: 'A.8.7',
  origin: 'asset',
  asset_key: 'asset:n1',
  office_id: 'o1',
  applicability: 'applicable',
  compliance: 1,
  sub: [],
  applied_rules: [],
  assessment_id: 'a-1',
  result_id: 'r-1',
  completed_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

const build = (assets: RiskInputAsset[], answers: AnswerEvidence[] = []) =>
  buildDeficiencyPairs({
    organizationId: 'org',
    policy: 'essential',
    assets,
    answers,
    monitoring: [
      { office_id: 'o1', efficacy: 1, reason_code: 'agent_reporting' },
      { office_id: 'o2', efficacy: 0, reason_code: 'agent_not_reporting' },
    ],
  })

const pairOf = (result: ReturnType<typeof build>, assetKey: string, control: string) =>
  result.pairs.find(pair => pair.asset_key === assetKey && pair.control_key === control)

const AUTOMATIC = ['A.5.12', 'A.5.9', 'A.8.16', 'A.8.20', 'A.8.21']

describe('buildDeficiencyPairs', () => {
  it('keeps a fully not-applicable control apart and out of the index (Plan §8.7)', () => {
    const withNotApplicable = build(
      [asset()],
      [answer({ control_key: 'A.7.9', applicability: 'not_applicable', compliance: null })]
    )
    const pair = pairOf(withNotApplicable, 'asset:n1', 'A.7.9')!
    assert.equal(pair.applicability, 'not_applicable')
    assert.equal(pair.status, 'not_applicable')
    assert.equal(pair.reason_code, 'not_applicable')
    const withoutAnswer = build([asset()])
    const index = (result: ReturnType<typeof build>) =>
      calculateDeficiencyIndex(result.pairs.filter(item => item.control_key !== 'A.7.9'))
    const withNa = calculateDeficiencyIndex(withNotApplicable.pairs)
    assert.equal(withNa.coverage, index(withoutAnswer).coverage)
    assert.equal(withNa.controls.some(control => control.control_key === 'A.7.9'), false)
  })

  it('uses the closing average when only some sub-questions are not applicable', () => {
    const result = build([asset()], [answer({ control_key: 'A.7.9', compliance: 0.6 })])
    const pair = pairOf(result, 'asset:n1', 'A.7.9')!
    assert.equal(pair.applicability, 'applicable')
    assert.equal(pair.compliance, 0.6)
    assert.equal(pair.status, 'partially_effective')
  })

  it('drops question pairs of an excluded asset but keeps its automatic ones and counts (Plan §8.9)', () => {
    const result = build([asset({ excluded: true })], [answer({})])
    assert.deepEqual(
      result.pairs.map(pair => pair.control_key),
      AUTOMATIC
    )
    assert.equal(result.assetCounts.in_scope, 1)
    assert.equal(result.assetCounts.excluded_from_assessment, 1)
  })

  it('blocks every pair of an unconfirmed network asset', () => {
    for (const overrides of [{ identified: false }, { authorization_status: 'pending' as const }]) {
      const result = build([asset(overrides)], [answer({ compliance: 0 })])
      assert.ok(result.pairs.length > 0)
      for (const pair of result.pairs) {
        assert.equal(pair.compliance, null)
        assert.equal(pair.reason_code, 'asset_unconfirmed')
      }
    }
  })

  it('weighs a manual and a network asset the same for equal control, criticality and compliance (Plan §8.11)', () => {
    const malware = (result: ReturnType<typeof build>) =>
      calculateDeficiencyIndex(result.pairs.filter(pair => pair.control_key === 'A.8.7'))
    const network = build([asset()], [answer({ compliance: 0.4 })])
    const manual = build(
      [asset({ key: 'manual:m1', source: 'manual', cidr: null, observation: null })],
      [answer({ asset_key: 'manual:m1', compliance: 0.4 })]
    )
    assert.deepEqual(malware(manual), malware(network))
  })

  it('counts overlapping asset dimensions without merging them (Plan §8.12)', () => {
    const counts = build([
      asset({ key: 'asset:a', identified: false, authorization_status: 'pending' }),
      asset({ key: 'asset:b', authorization_status: 'unauthorized' }),
      asset({ key: 'manual:c', source: 'manual', observation: null, cidr: null }),
    ]).assetCounts
    assert.deepEqual(counts, {
      in_scope: 3,
      excluded_from_assessment: 0,
      unidentified: 1,
      authorization_pending: 1,
      unauthorized: 1,
    })
  })

  it('groups shared-CIDR context by office and CIDR, never by the CIDR alone (Plan §8.16)', () => {
    const unknown = asset({ key: 'asset:u', identified: false, risk_type: null })
    const critical = asset({ key: 'asset:c', criticality: 'critical' })
    const otherOffice = build([unknown, { ...critical, office_id: 'o2' }])
    assert.deepEqual(otherOffice.context.shared_cidr, [])
    const sameOffice = build([unknown, critical])
    assert.deepEqual(sameOffice.context.shared_cidr, [
      { office_id: 'o1', cidr: '10.0.0.0/24', unidentified_assets: 1, important_assets: ['asset:c'] },
    ])
  })

  it('reports agent visibility once per office', () => {
    const result = build([asset({ key: 'asset:a' }), asset({ key: 'asset:b' })])
    assert.deepEqual(result.context.office_visibility, [
      { office_id: 'o1', reason_code: 'agent_reporting' },
      { office_id: 'o2', reason_code: 'agent_not_reporting' },
    ])
  })

  it('returns pairs in a deterministic order regardless of input order', () => {
    const assets = [
      asset({ key: 'asset:b' }),
      asset({ key: 'manual:a', source: 'manual', observation: null }),
      asset({ key: 'asset:a' }),
    ]
    const keys = (result: ReturnType<typeof build>) =>
      result.pairs.map(pair => `${pair.asset_key}|${pair.control_key}`)
    assert.deepEqual(keys(build(assets)), keys(build([...assets].reverse())))
    assert.deepEqual(keys(build(assets)), [...keys(build(assets))].sort())
  })

  it('scores the gateway Telnet + uncertain UDP case as 0, evaluated, with a deficiency and a pending (D25)', () => {
    const gateway = (services: unknown[]) =>
      asset({
        key: 'asset:g1',
        risk_type: 'network_device',
        observation: networkObservation({
          id: 'g1',
          status: 'active',
          last_seen: '2026-11-10T00:00:00.000Z',
          identified: true,
          authorization_status: 'authorized',
          confirmed_type: 'gateway',
          asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
          services,
        } as unknown as Asset),
      })
    const telnet = { protocol: 'tcp', port: 23, state: 'open', confidence: 10 }
    const snmp = { protocol: 'udp', port: 161, state: 'open|filtered', confidence: 10 }
    const result = build([gateway([telnet, snmp])])
    const pair = pairOf(result, 'asset:g1', 'A.8.21')!
    assert.equal(pair.compliance, 0)
    assert.equal(pair.status, 'non_compliant')
    assert.deepEqual(pair.reasons.map(reason => reason.list), ['deficiency', 'pending'])
    const a821 = calculateDeficiencyIndex(result.pairs).controls.find(item => item.control_key === 'A.8.21')!
    assert.equal(a821.coverage, 1)

    // A D26 antecedent is context only: the index is identical with or without history.
    const filtered = [gateway([{ ...telnet, state: 'filtered' }, snmp])]
    const history: NetworkHistoryRow[] = [
      {
        id: 'r-1',
        createdAt: '2026-11-01T00:00:01.000Z',
        evaluated_at: '2026-11-01T00:00:00.000Z',
        asset_key: 'asset:g1',
        service_key: 'tcp:23',
        check_key: 'network.telnet.confirmed',
        status: 'non_compliant',
        reason_code: 'network_prohibited',
        observation: {
          observed_at: '2026-11-01T00:00:00.000Z',
          asset_status: 'active',
          identified: true,
          authorization_status: 'authorized',
          port_scan: 'complete',
          service_detection: 'complete',
        },
      },
    ]
    const withHistory = buildDeficiencyPairs({
      organizationId: 'org',
      policy: 'essential',
      assets: filtered,
      answers: [],
      monitoring: [],
      networkHistory: history,
    })
    const without = buildDeficiencyPairs({ organizationId: 'org', policy: 'essential', assets: filtered, answers: [], monitoring: [] })
    const previousOf = (pairs: typeof without.pairs) => {
      const evidence = pairs.find(item => item.control_key === 'A.8.21')!.evidence
      return evidence.kind === 'network' ? evidence.findings[0].previous : undefined
    }
    assert.equal(previousOf(withHistory.pairs)?.result_id, 'r-1')
    assert.equal(previousOf(without.pairs), undefined)
    assert.deepEqual(calculateDeficiencyIndex(withHistory.pairs), calculateDeficiencyIndex(without.pairs))
    assert.equal(pairOf(withHistory, 'asset:g1', 'A.8.21')!.priority, null)
  })
})
