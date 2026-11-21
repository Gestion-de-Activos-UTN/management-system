import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnswerEvidence } from './answer-evidence'
import type { RiskInputAsset } from './deficiency-pairs'
import { calculateDeficiencyIndex } from './deficiency-index'
import { buildDeficiencyPairs } from './deficiency-pairs'
import type { Asset } from '@/app/types/payload-types'
import { networkObservation } from './network-evidence'
import {
  ANSWER_PRIORITY,
  CRITICALITY_ELEVATION,
  CRITICAL_COMBINATIONS,
  TYPE_OVERRIDES,
  countDeficiencies,
  countPendingServices,
  pairReasons,
  validatePriorityPolicy,
} from './priority'

const asset = (overrides: Partial<RiskInputAsset> = {}): RiskInputAsset => ({
  key: 'asset:s1',
  source: 'network',
  office_id: 'o1',
  risk_type: 'server',
  criticality: 'critical',
  identified: true,
  authorization_status: 'authorized',
  has_owner: true,
  cidr: null,
  excluded: false,
  observation: null,
  ...overrides,
})

/** A combined answer as the Assessment closing stores it; `options` maps question → option. */
const answer = (
  control: string,
  options: Record<string, string>,
  overrides: Partial<AnswerEvidence> = {}
): AnswerEvidence => ({
  control_key: control,
  origin: 'asset',
  asset_key: 'asset:s1',
  office_id: 'o1',
  applicability: 'applicable',
  compliance: 0,
  sub: Object.entries(options).map(([question_key, option_key]) => ({
    question_key,
    option_key,
    base: null,
    adjusted: null,
    answered_at: null,
  })),
  applied_rules: [],
  assessment_id: 'a-1',
  result_id: `r-${control}`,
  completed_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

type Service = NonNullable<Asset['services']>[number]
const observedDoc = (services: Service[], overrides: Partial<Asset> = {}): Asset =>
  ({
    id: 'g1',
    status: 'active',
    last_seen: '2026-11-10T00:00:00.000Z',
    identified: true,
    authorization_status: 'authorized',
    confirmed_type: 'gateway',
    asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    services,
    ...overrides,
  }) as unknown as Asset
const observed = (services: Service[], overrides: Partial<RiskInputAsset> = {}, doc = {}) =>
  asset({ key: 'asset:g1', observation: networkObservation(observedDoc(services, doc)), ...overrides })

const pairsFor = (assets: RiskInputAsset[], answers: AnswerEvidence[]) =>
  buildDeficiencyPairs({ organizationId: 'org', policy: 'essential', assets, answers, monitoring: [] }).pairs

const reasonsOf = (assetOverrides: Partial<RiskInputAsset>, item: AnswerEvidence) =>
  pairsFor([asset(assetOverrides)], [item]).find(pair => pair.control_key === item.control_key)!

describe('priority policy', () => {
  const policy = () => ({
    answers: structuredClone(ANSWER_PRIORITY) as Record<string, Record<string, unknown>>,
    overrides: [...TYPE_OVERRIDES],
    elevation: [...CRITICALITY_ELEVATION],
    critical: [...CRITICAL_COMBINATIONS],
  })
  const validate = (value: ReturnType<typeof policy>) =>
    validatePriorityPolicy(value as Parameters<typeof validatePriorityPolicy>[0])

  it('covers every scored option of the catalog and nothing else', () => {
    assert.doesNotThrow(() => validatePriorityPolicy())
    const missing = policy()
    delete missing.answers['A.8.2.privileged_access'].multiple_as_needed
    assert.throws(() => validate(missing), /misses option/)
    const extra = policy()
    extra.answers['A.8.2.privileged_access'].typo = null
    assert.throws(() => validate(extra), /missing option/)
    const silent = policy()
    silent.answers['A.8.5.unlock'].simple_pin = null
    assert.throws(() => validate(silent), /unexplained/)
  })

  it('rejects typos, foreign types and no-op elevations in the context lists', () => {
    const typoElevation = policy()
    typoElevation.elevation.push({ question_key: 'A.8.13.backup', option_key: 'personal_clod' })
    assert.throws(() => validate(typoElevation), /Criticality elevation names missing option/)
    const typoCritical = policy()
    typoCritical.critical.push({ question_key: 'A.8.2.privileged_acces', option_key: 'generic_or_default' })
    assert.throws(() => validate(typoCritical), /Critical combination names missing option/)
    const foreignType = policy()
    foreignType.critical.push({ question_key: 'A.8.5.unlock', option_key: 'none', asset_types: ['gateway'] })
    assert.throws(() => validate(foreignType), /type gateway outside/)
    const noOp = policy()
    noOp.elevation.push({ question_key: 'A.8.5.unlock', option_key: 'none' })
    assert.throws(() => validate(noOp), /needs a medium base/)
    const override = policy()
    override.overrides.push({ question_key: 'A.7.9.remote_actions', option_key: 'nope', priority: 'high' })
    assert.throws(() => validate(override), /Type override names missing option/)
  })
})

describe('pair reasons — reference cases (propuesta §9)', () => {
  it('§9.1 critical server with a generic admin credential → critical', () => {
    const pair = reasonsOf({}, answer('A.8.2', { 'A.8.2.privileged_access': 'generic_or_default' }))
    assert.equal(pair.priority, 'critical')
    assert.deepEqual(pair.reasons[0].adjustments, ['critical_combination'])
  })

  it('§9.2 multiple_as_needed on a critical server → verification raised to high', () => {
    const pair = reasonsOf({}, answer('A.8.2', { 'A.8.2.privileged_access': 'multiple_as_needed' }))
    assert.equal(pair.reasons[0].class, 'verification')
    assert.equal(pair.priority, 'high')
  })

  it('§9.3 critical router with default password and automatic firmware → critical, no firmware reason', () => {
    const pair = reasonsOf(
      { risk_type: 'gateway' },
      answer(
        'A.8.9/A.8.20',
        { 'A.8.9-20.default_password': 'default', 'A.8.9-20.firmware': 'automatic' },
        { applied_rules: ['A.8.9-20.default_password_reduces_firmware'] }
      )
    )
    assert.equal(pair.priority, 'critical')
    assert.deepEqual(pair.reasons.map(reason => reason.source), [
      { kind: 'answer', question_key: 'A.8.9-20.default_password', option_key: 'default' },
    ])
  })

  it('§9.4 strong_password is a low improvement; simple_pin stays medium even on a critical asset', () => {
    const strong = reasonsOf({}, answer('A.8.5', { 'A.8.5.unlock': 'strong_password', 'A.8.5.idle_lock': 'under_3m' }))
    assert.equal(strong.priority, 'low')
    assert.equal(strong.reasons[0].class, 'improvement')
    const pin = reasonsOf({}, answer('A.8.5', { 'A.8.5.unlock': 'simple_pin', 'A.8.5.idle_lock': 'under_3m' }))
    assert.equal(pin.priority, 'medium')
    assert.equal(pin.reasons[0].class, 'verification')
  })

  it('§9.5 no active protection with unknown updates → one high reason, no pending for the forced update', () => {
    const pair = reasonsOf(
      { criticality: 'high' },
      answer(
        'A.8.7',
        { 'A.8.7.protection_active': 'none', 'A.8.7.protection_updates': 'unknown' },
        { applied_rules: ['A.8.7.no_protection_forces_updates_zero'] }
      )
    )
    assert.equal(pair.priority, 'high')
    assert.equal(pair.reasons.length, 1)
    assert.equal(pair.reasons[0].list, 'deficiency')
  })

  it('§9.6 corporate cloud raises nothing; local copy is a low improvement', () => {
    assert.deepEqual(reasonsOf({}, answer('A.8.13', { 'A.8.13.backup': 'corporate_cloud' }, { compliance: 1 })).reasons, [])
    assert.equal(reasonsOf({}, answer('A.8.13', { 'A.8.13.backup': 'local_with_backup' })).priority, 'low')
  })

  it('§9.7 a network review is pending without priority', () => {
    const pair = pairsFor([observed([{ protocol: 'tcp', port: 3389, state: 'open', confidence: 10 }])], []).find(
      item => item.control_key === 'A.8.21'
    )!
    assert.equal(pair.priority, null)
    assert.equal(pair.reasons[0].list, 'pending')
    assert.equal(pair.reasons[0].class, 'review_pending')
  })

  it('§9.8 an agent outage raises no reason per asset', () => {
    const pair = buildDeficiencyPairs({
      organizationId: 'org',
      policy: 'essential',
      assets: [asset()],
      answers: [],
      monitoring: [{ office_id: 'o1', efficacy: 0, reason_code: 'agent_not_reporting' }],
    }).pairs.find(item => item.control_key === 'A.8.16')!
    assert.deepEqual(pair.reasons, [])
  })

  it('§9.9 not-applicable raises nothing; unknown is pending next to a known reason of the same pair', () => {
    const notApplicable = reasonsOf(
      { risk_type: 'workstation' },
      answer('A.7.9', { 'A.7.9.physical_protection': 'not_applicable', 'A.7.9.remote_actions': 'not_applicable' }, {
        applicability: 'not_applicable',
        compliance: null,
      })
    )
    assert.deepEqual(notApplicable.reasons, [])
    const mixed = reasonsOf(
      { risk_type: 'workstation' },
      answer('A.7.9', { 'A.7.9.physical_protection': 'none', 'A.7.9.remote_actions': 'unknown' }, { compliance: null })
    )
    assert.deepEqual(mixed.reasons.map(reason => reason.list), ['deficiency', 'pending'])
    assert.equal(mixed.priority, 'high')
  })
})

describe('pair reasons — context rules', () => {
  it('remote_actions=none is medium on mobile and low on workstation or an unknown type', () => {
    const none = (risk_type: RiskInputAsset['risk_type']) =>
      reasonsOf({ risk_type, criticality: 'low' }, answer('A.7.9', { 'A.7.9.remote_actions': 'none' })).reasons.find(
        reason => reason.source.kind === 'answer' && reason.source.question_key === 'A.7.9.remote_actions'
      )
    assert.equal(none('mobile')?.priority, 'medium')
    assert.equal(none('workstation')?.priority, 'low')
    // Not reachable from the catalog today; the policy still defines it.
    const pair = buildDeficiencyPairs({
      organizationId: 'org',
      policy: 'essential',
      assets: [asset({ risk_type: 'workstation', criticality: 'low' })],
      answers: [answer('A.7.9', { 'A.7.9.remote_actions': 'none' })],
      monitoring: [],
    }).pairs.find(item => item.control_key === 'A.7.9')!
    const unknownType = { ...pair, asset_type: null }
    assert.equal(pairReasons(unknownType)[0].priority, 'low')
  })

  it('lifts a lower base to the critical floor (floors compose by max)', () => {
    const pair = reasonsOf({ criticality: 'critical' }, answer('A.8.13', { 'A.8.13.backup': 'local_only' }))
    assert.equal(pair.priority, 'critical')
  })

  it('never raises an inherited declaration by the criticality of the asset it reaches', () => {
    const shared = answer('A.8.22', { 'A.8.22.guest_wifi': 'no' }, { origin: 'organization', asset_key: null, office_id: null })
    assert.equal(reasonsOf({ criticality: 'critical' }, shared).priority, 'medium')
    const sharedAdmin = answer('A.8.2', { 'A.8.2.privileged_access': 'generic_or_default' }, {
      origin: 'office',
      asset_key: null,
    })
    assert.notEqual(reasonsOf({ criticality: 'critical' }, sharedAdmin).priority, 'critical')
  })

  it('keeps an unknown criticality at its base priority', () => {
    const pair = reasonsOf({ criticality: 'unknown' }, answer('A.8.2', { 'A.8.2.privileged_access': 'multiple_as_needed' }))
    assert.equal(pair.priority, 'medium')
  })

  it('makes idle_lock a subordinate context of unlock=none and counts it once', () => {
    const pair = reasonsOf(
      {},
      answer('A.8.5', { 'A.8.5.unlock': 'none', 'A.8.5.idle_lock': 'none' }, {
        applied_rules: ['A.8.5.no_unlock_forces_idle_zero'],
      })
    )
    const idle = pair.reasons.find(reason => reason.source.kind === 'answer' && reason.source.question_key === 'A.8.5.idle_lock')!
    const unlock = pair.reasons.find(reason => reason.source.kind === 'answer' && reason.source.question_key === 'A.8.5.unlock')!
    assert.equal(idle.subordinate_to, unlock.key)
    assert.equal(pair.priority, 'critical')
    assert.deepEqual(countDeficiencies([pair]), { low: 0, medium: 0, high: 0, critical: 1 })
  })

  it('refuses an office declaration without office; distinct offices get distinct keys', () => {
    // selectAnswer already drops it (no office to match); the evaluator also refuses it on its own.
    const broken = answer('A.8.22', { 'A.8.22.guest_wifi': 'no' }, { origin: 'office', asset_key: null, office_id: null })
    assert.equal(pairsFor([asset()], [broken]).find(item => item.control_key === 'A.8.22')!.reason_code, 'answer_missing')
    const valid = pairsFor([asset()], [{ ...broken, office_id: 'o1' }]).find(item => item.control_key === 'A.8.22')!
    assert.throws(
      () => pairReasons({ ...valid, evidence: { kind: 'answer', answer: broken } }),
      /has no office/
    )
    const office = (id: string) =>
      buildDeficiencyPairs({
        organizationId: 'org',
        policy: 'essential',
        assets: [asset({ office_id: id })],
        answers: [answer('A.8.22', { 'A.8.22.guest_wifi': 'no' }, { origin: 'office', asset_key: null, office_id: id })],
        monitoring: [],
      }).pairs.find(item => item.control_key === 'A.8.22')!.reasons[0].key
    assert.notEqual(office('o1'), office('o2'))
  })

  it('gives an unconfirmed asset a single survey pending on A.5.9', () => {
    const pairs = pairsFor([asset({ identified: false })], [answer('A.8.2', { 'A.8.2.privileged_access': 'generic_or_default' })])
    const reasons = pairs.flatMap(pair => pair.reasons.map(reason => [pair.control_key, reason.reason_code]))
    assert.deepEqual(reasons, [['A.5.9', 'asset_unconfirmed']])
  })

  it('treats a confirmed unauthorized asset as a high deficiency', () => {
    const pair = pairsFor([asset({ authorization_status: 'unauthorized' })], []).find(item => item.control_key === 'A.8.20')!
    assert.equal(pair.priority, 'high')
    assert.equal(pair.reasons[0].reason_code, 'asset_unauthorized')
  })
})

describe('pair reasons — aggregation', () => {
  it('counts an inherited declaration once across assets', () => {
    const shared = answer('A.5.15', { 'A.5.15.individual_accounts': 'no', 'A.5.15.access_revocation': 'yes' }, {
      origin: 'organization',
      asset_key: null,
      office_id: null,
    })
    const pairs = pairsFor([asset({ key: 'asset:a' }), asset({ key: 'asset:b' })], [shared])
    const keys = pairs.filter(pair => pair.control_key === 'A.5.15').map(pair => pair.reasons[0].key)
    assert.equal(new Set(keys).size, 1)
    assert.equal(countDeficiencies(pairs).medium, 1)
  })

  it('never changes the index', () => {
    const pairs = pairsFor([asset()], [answer('A.8.2', { 'A.8.2.privileged_access': 'multiple_as_needed' }, { compliance: 0.4 })])
    const stripped = pairs.map(pair => ({ ...pair, reasons: [], priority: null }))
    assert.deepEqual(calculateDeficiencyIndex(pairs), calculateDeficiencyIndex(stripped))
  })

  it('explains the 11.71 reference fixture with three high reasons in Deficiencias (Plan §8.17)', () => {
    const servers = ['asset:s1', 'asset:s2', 'asset:s3']
    const pairs = pairsFor(
      servers.map(key => asset({ key })),
      servers.map(key => answer('A.8.2', { 'A.8.2.privileged_access': 'multiple_as_needed' }, { asset_key: key, compliance: 0.4, result_id: key }))
    ).filter(pair => pair.control_key === 'A.8.2')
    assert.deepEqual(pairs.map(pair => pair.priority), ['high', 'high', 'high'])
    assert.equal(countDeficiencies(pairs).high, 3)
  })
})

describe('pair reasons — network services (D25)', () => {
  const telnet = { protocol: 'tcp', port: 23, state: 'open', confidence: 10 } as Service
  const snmp = { protocol: 'udp', port: 161, state: 'open|filtered', confidence: 10 } as Service
  const networkPair = (pairs: ReturnType<typeof pairsFor>, key = 'asset:g1') =>
    pairs.find(item => item.asset_key === key && item.control_key === 'A.8.21')!

  it('gives one reason per service: Telnet high on a critical asset, never elevated; UDP pending', () => {
    const pair = networkPair(pairsFor([observed([telnet, snmp])], []))
    assert.equal(pair.compliance, 0)
    assert.equal(pair.priority, 'high')
    assert.deepEqual(
      pair.reasons.map(reason => [reason.key, reason.list, reason.class, reason.priority, reason.adjustments]),
      [
        ['asset:g1|A.8.21|tcp:23|network.telnet.confirmed', 'deficiency', 'deficiency', 'high', []],
        ['asset:g1|A.8.21|udp:161|network.service:udp:161', 'pending', 'missing_information', null, []],
      ]
    )
    assert.deepEqual(pair.reasons[1].source, { kind: 'check', check_key: 'network.service:udp:161', service_key: 'udp:161' })
  })

  it('leaves a single pending for a blocked pair, without per-service reasons', () => {
    const pair = networkPair(pairsFor([observed([telnet], {}, { status: 'offline' })], []))
    assert.deepEqual(pair.reasons.map(reason => reason.key), ['asset:g1|A.8.21|scan_missing_or_incomplete'])
  })

  it('keeps an unconfirmed asset to its A.5.9 survey pending even with services', () => {
    const pairs = pairsFor([observed([telnet, snmp], { identified: false })], [])
    assert.deepEqual(pairs.flatMap(pair => pair.reasons.map(reason => reason.key)), ['asset:g1|A.5.9|asset_unconfirmed'])
  })

  it('counts pending services by asset and service, once each', () => {
    const pairs = pairsFor(
      [
        observed([telnet, snmp, { ...snmp, port: 162 } as Service]),
        observed([snmp], { key: 'asset:g2' }),
      ],
      []
    )
    assert.deepEqual(countPendingServices(pairs), { services: 3, assets: 2 })
    assert.deepEqual(countPendingServices([...pairs, ...pairs]), { services: 3, assets: 2 })
  })
})
