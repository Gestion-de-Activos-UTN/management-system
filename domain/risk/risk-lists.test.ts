import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset } from '@/app/types/payload-types'
import type { AnswerEvidence } from './answer-evidence'
import { buildDeficiencyPairs, type RiskInputAsset, type RiskOfficeMonitoring } from './deficiency-pairs'
import { networkObservation, type NetworkHistoryRow } from './network-evidence'
import { contributionFromPair } from './persistRiskEvaluation'
import { buildRiskLists, byControlKey, type ListRow } from './risk-lists'

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

const sub = (question_key: string, option_key: string) => ({
  question_key,
  option_key,
  base: null,
  adjusted: null,
  answered_at: null,
})

const answer = (overrides: Partial<AnswerEvidence>): AnswerEvidence => ({
  control_key: 'A.5.15',
  origin: 'organization',
  asset_key: null,
  office_id: null,
  applicability: 'applicable',
  compliance: 0,
  sub: [sub('A.5.15.access_revocation', 'no')],
  applied_rules: [],
  assessment_id: 'a-1',
  result_id: 'r-1',
  completed_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

const observed = (services: unknown[]) =>
  networkObservation({
    id: 'g1',
    status: 'active',
    last_seen: '2026-11-10T00:00:00.000Z',
    identified: true,
    authorization_status: 'authorized',
    confirmed_type: 'gateway',
    asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    port_scan_coverage: [{ protocol: 'tcp', status: 'complete', port_spec: '1-1000' }],
    services,
  } as unknown as Asset)

const lists = (
  assets: RiskInputAsset[],
  answers: AnswerEvidence[] = [],
  options: { monitoring?: RiskOfficeMonitoring[]; history?: NetworkHistoryRow[]; scope?: Set<string> } = {}
) => {
  const built = buildDeficiencyPairs({
    organizationId: 'org',
    policy: 'essential',
    assets,
    answers,
    monitoring: options.monitoring ?? [],
    networkHistory: options.history,
  })
  const rows: ListRow[] = built.pairs.map(contributionFromPair)
  return { rows, context: built.context, ...buildRiskLists(rows, built.context, options.scope) }
}

describe('buildRiskLists', () => {
  it('shows a shared declaration once, with every asset it reaches and the most critical for order only', () => {
    const { deficiencies } = lists(
      [asset({ key: 'manual:a' }), asset({ key: 'manual:b', criticality: 'critical' }), asset({ key: 'manual:c' })],
      [answer({})]
    )
    const shared = deficiencies.filter(item => item.control_key === 'A.5.15')
    assert.equal(shared.length, 1)
    assert.deepEqual(shared[0].subject, { kind: 'organization', affected_assets: 3 })
    // access_revocation=no is high on its own; a critical asset never raises a shared declaration.
    assert.equal(shared[0].priority, 'high')
  })

  it('keeps low reasons out as rows but inside the detail of an item that enters', () => {
    const own = (option: string, extra: ReturnType<typeof sub>[] = []) =>
      answer({
        control_key: 'A.8.13',
        origin: 'asset',
        asset_key: 'manual:a',
        office_id: 'o1',
        sub: [sub('A.8.13.backup', option), ...extra],
      })
    assert.equal(lists([asset({})], [own('local_with_backup')]).deficiencies.length, 0)
    const withHigh = lists([asset({})], [own('local_only')]).deficiencies
    assert.equal(withHigh.length, 1)
    assert.equal(withHigh[0].priority, 'high')
  })

  it('lists a pair in both lists when it fails and still has pending services (D25)', () => {
    const { deficiencies, pending } = lists([
      asset({
        key: 'asset:g1',
        source: 'network',
        risk_type: 'gateway',
        observation: observed([
          { protocol: 'tcp', port: 23, state: 'open', confidence: 10 },
          { protocol: 'udp', port: 161, state: 'open|filtered', confidence: 10 },
          { protocol: 'udp', port: 162, state: 'filtered', confidence: 10 },
        ]),
      }),
    ])
    const failing = deficiencies.find(item => item.control_key === 'A.8.21' && item.priority === 'high')!
    // The deficiency item carries its own pending reasons: the UI never crosses paginated lists.
    assert.deepEqual(
      failing.reasons.filter(reason => reason.list === 'pending').map(reason => reason.service_key),
      ['udp:161', 'udp:162']
    )
    const network = pending.filter(item => item.control_key === 'A.8.21')
    assert.equal(network.length, 1, 'one item per asset, every pending service inside')
    assert.deepEqual(network[0].reasons.map(reason => reason.service_key), ['udp:161', 'udp:162'])
  })

  it('carries the D26 antecedent with its historical check, also for a service no longer observed', () => {
    const history: NetworkHistoryRow[] = [
      {
        id: 'r-old',
        createdAt: '2026-11-01T00:00:01.000Z',
        evaluated_at: '2026-11-01T00:00:00.000Z',
        asset_key: 'asset:g1',
        service_key: 'udp:23',
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
    const { pending } = lists(
      [asset({ key: 'asset:g1', source: 'network', risk_type: 'gateway', observation: observed([]) })],
      [],
      { history }
    )
    const reason = pending.find(item => item.control_key === 'A.8.21')!.reasons[0]
    assert.equal(reason.check_key, 'network.service:udp:23')
    assert.equal(reason.previous?.result_id, 'r-old')
    assert.equal(reason.previous?.check_key, 'network.telnet.confirmed')
  })

  it('puts the survey block first (A.5.12, A.5.9, A.8.16) and one monitoring notice per office in scope', () => {
    const { pending } = lists(
      [
        asset({ key: 'asset:u', source: 'network', identified: false, authorization_status: 'pending', risk_type: null }),
        asset({ key: 'manual:x', criticality: 'unknown' }),
        asset({ key: 'manual:y', office_id: 'o2' }),
        asset({ key: 'manual:z', office_id: 'o2' }),
      ],
      [],
      {
        monitoring: [
          { office_id: 'o1', efficacy: 1, reason_code: 'agent_reporting' },
          { office_id: 'o2', efficacy: 0, reason_code: 'agent_not_reporting' },
          { office_id: 'o3', efficacy: null, reason_code: 'agent_missing' },
        ],
        scope: new Set(['o1', 'o2']),
      }
    )
    const survey = pending.filter(item => item.group === 'survey')
    assert.deepEqual(
      survey.map(item => item.control_key),
      ['A.5.12', 'A.5.9', 'A.8.16']
    )
    assert.ok(pending.slice(0, survey.length).every(item => item.group === 'survey'))
    // One notice for o2 although it has two assets; o3 is outside the scope.
    assert.deepEqual(
      survey.filter(item => item.control_key === 'A.8.16').map(item => item.subject),
      [{ kind: 'office', id: 'o2', affected_assets: 0 }]
    )
    // The unconfirmed asset is a single survey item, not one pending per control.
    assert.equal(pending.filter(item => item.subject.kind === 'asset' && item.subject.asset_key === 'asset:u').length, 1)
    assert.ok(survey.every(item => item.importance === null))
  })

  it('orders by rank, then natural control key, never by text', () => {
    assert.deepEqual(
      ['A.8.20', 'A.8.19', 'A.8.9/A.8.20', 'A.8.2', 'A.5.15'].sort(byControlKey),
      ['A.5.15', 'A.8.2', 'A.8.9/A.8.20', 'A.8.19', 'A.8.20']
    )
    const { deficiencies } = lists(
      [
        asset({ key: 'manual:s', risk_type: 'server', criticality: 'critical' }),
        asset({ key: 'manual:w', risk_type: 'workstation', criticality: 'low' }),
      ],
      [
        answer({}),
        answer({ control_key: 'A.8.2', origin: 'asset', asset_key: 'manual:s', office_id: 'o1', sub: [sub('A.8.2.privileged_access', 'generic_or_default')] }),
        answer({ control_key: 'A.8.13', origin: 'asset', asset_key: 'manual:w', office_id: 'o1', sub: [sub('A.8.13.backup', 'personal_cloud')] }),
      ]
    )
    assert.deepEqual(
      deficiencies.map(item => [item.priority, item.control_key]),
      [
        ['critical', 'A.8.2'],
        ['high', 'A.5.15'],
        ['medium', 'A.8.13'],
      ]
    )
  })

  it('counts assets over every row of a group and ignores empty asset keys', () => {
    const { rows, context } = lists([asset({ key: 'manual:a' }), asset({ key: 'manual:b' })], [answer({})])
    const withEmpty = [...rows, { ...rows.find(row => row.control_key === 'A.5.15')!, asset_key: '' }]
    const item = buildRiskLists(withEmpty, context).deficiencies.find(entry => entry.control_key === 'A.5.15')!
    assert.deepEqual(item.subject, { kind: 'organization', affected_assets: 2 })
  })

  it('is deterministic: pages concatenate to the whole list and the same rows give the same lists', () => {
    const assets = Array.from({ length: 7 }, (_, index) =>
      asset({ key: `manual:${index}`, criticality: (['low', 'medium', 'high', 'critical'] as const)[index % 4] })
    )
    const first = lists(assets)
    const again = buildRiskLists([...first.rows].reverse(), first.context)
    assert.deepEqual(again, { deficiencies: first.deficiencies, pending: first.pending })
    const keys = first.pending.map(item => item.key)
    const pages = Array.from({ length: Math.ceil(keys.length / 5) }, (_, page) =>
      keys.slice(page * 5, page * 5 + 5)
    ).flat()
    assert.deepEqual(pages, keys)
    assert.equal(new Set(keys).size, keys.length)
  })
})
