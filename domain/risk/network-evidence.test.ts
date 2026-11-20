import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Asset } from '@/app/types/payload-types'
import { absenceConfirmed } from '@/domain/inventories/port-coverage'
import {
  latestFirst,
  networkObservation,
  selectPreviousFinding,
  summarizeNetwork,
  type NetworkHistoryRow,
  type ObservationSnapshot,
} from './network-evidence'

type Service = NonNullable<Asset['services']>[number]
const svc = (protocol: 'tcp' | 'udp', port: number, state = 'open', confidence = 10): Service =>
  ({ protocol, port, state, confidence, name: 'svc', product: 'p', scripts: [{ id: 'raw' }] }) as unknown as Service

const observedDoc = (services: Service[], overrides: Partial<Asset> = {}): Asset =>
  ({
    id: 'g1',
    status: 'active',
    last_seen: '2026-11-10T00:00:00.000Z',
    identified: true,
    authorization_status: 'authorized',
    confirmed_type: 'gateway',
    asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
    port_scan_coverage: [{ protocol: 'tcp', status: 'complete', port_spec: '1-1000' }],
    services,
    ...overrides,
  }) as unknown as Asset

const summarize = (services: Service[], overrides: Partial<Asset> = {}, history: NetworkHistoryRow[] = []) =>
  summarizeNetwork(networkObservation(observedDoc(services, overrides)), 'asset:g1', history)

const TELNET = svc('tcp', 23)
const UNCERTAIN = ['filtered', 'unfiltered', 'open|filtered', 'closed|filtered', 'unknown']

const trusted: ObservationSnapshot = {
  observed_at: '2026-11-01T00:00:00.000Z',
  asset_status: 'active',
  identified: true,
  authorization_status: 'authorized',
  port_scan: 'complete',
  service_detection: 'complete',
}
const row = (overrides: Partial<NetworkHistoryRow>): NetworkHistoryRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-01T00:00:01.000Z',
  evaluated_at: '2026-11-01T00:00:00.000Z',
  asset_key: 'asset:g1',
  service_key: 'tcp:23',
  check_key: 'network.telnet.confirmed',
  status: 'non_compliant',
  reason_code: 'network_prohibited',
  observation: trusted,
  ...overrides,
})

describe('summarizeNetwork (D25)', () => {
  it('keeps a valid prohibited service next to each uncertain one, on TCP and UDP', () => {
    for (const protocol of ['tcp', 'udp'] as const)
      for (const state of UNCERTAIN) {
        const result = summarize([TELNET, svc(protocol, 161, state)])
        assert.equal(result.compliance, 0, `${protocol} ${state}`)
        assert.deepEqual(
          result.findings.map(item => [item.service_key, item.baseline]),
          [['tcp:23', 'prohibited'], [`${protocol}:161`, 'uncertain']]
        )
      }
  })

  it('is null with an expected and an uncertain service, or only uncertain ones', () => {
    assert.equal(summarize([svc('tcp', 53), svc('udp', 161, 'open|filtered')]).compliance, null)
    assert.equal(summarize([svc('udp', 161, 'filtered')]).reason_code, 'network_review_required')
  })

  it('scores 0 with pending review, unclassified or low-confidence services beside a prohibited one', () => {
    const result = summarize([TELNET, svc('tcp', 3389), svc('tcp', 8080), svc('tcp', 445, 'open', 3)])
    assert.equal(result.compliance, 0)
    assert.deepEqual(
      result.findings.map(item => item.baseline),
      ['prohibited', 'insufficient_confidence', 'review', 'unmatched'] // tcp:23, 445, 3389, 8080
    )
  })

  it('treats a prohibited port with its own insufficient confidence as pending, not a breach', () => {
    const result = summarize([svc('tcp', 23, 'open', 5)])
    assert.equal(result.compliance, null)
    assert.equal(result.findings[0].baseline, 'insufficient_confidence')
  })

  it('blocks on partial, unknown or missing coverage and on an offline asset, even with Telnet', () => {
    for (const coverage of ['partial', 'unknown', 'not_attempted']) {
      for (const field of ['port_scan', 'service_detection']) {
        const result = summarize([TELNET], {
          asset_coverage: { port_scan: 'complete', service_detection: 'complete', [field]: coverage },
        } as Partial<Asset>)
        assert.equal(result.compliance, null)
        assert.equal(result.reason_code, 'technical_coverage_insufficient')
        assert.deepEqual(result.findings, [])
      }
    }
    const offline = summarize([TELNET], { status: 'offline' })
    assert.deepEqual([offline.compliance, offline.reason_code], [null, 'scan_missing_or_incomplete'])
    assert.equal(summarize([], { asset_coverage: undefined }).compliance, null)
  })

  it('scores 1 limited to the baseline with only expected, closed or no services', () => {
    for (const services of [[svc('tcp', 53)], [svc('tcp', 23, 'closed')], []]) {
      const result = summarize(services)
      assert.deepEqual([result.compliance, result.findings], [1, []])
    }
    assert.equal(summarize([svc('tcp', 53), svc('tcp', 23, 'closed')]).evidence.expected_count, 1)
    assert.equal(summarize([svc('tcp', 23, 'closed')]).evidence.closed_count, 1)
  })

  it('keeps tcp and udp on the same port apart, orders stably and only names the service', () => {
    const services = [svc('udp', 53, 'filtered'), svc('tcp', 53, 'filtered'), TELNET]
    const result = summarize(services)
    assert.deepEqual(result.findings.map(item => item.service_key), ['tcp:23', 'tcp:53', 'udp:53'])
    assert.deepEqual(summarize([...services].reverse()).findings, result.findings)
    assert.deepEqual(result.findings[0].evidence, { name: 'svc', product: 'p' })
  })

  it('changing one pending service leaves the other findings untouched', () => {
    const before = summarize([TELNET, svc('tcp', 3389), svc('udp', 161, 'filtered')])
    const after = summarize([TELNET, svc('tcp', 3389), svc('udp', 162, 'filtered')])
    assert.deepEqual(before.findings.slice(0, 2), after.findings.slice(0, 2))
  })

  it('keeps every relevant finding of 4096 services without truncation', () => {
    const services = Array.from({ length: 4096 }, (_, index) => svc('tcp', 1001 + index, 'filtered'))
    assert.equal(summarize(services).findings.length, 4096)
  })
})

describe('selectPreviousFinding (D26)', () => {
  const now = '2026-11-10T00:00:00.000Z'
  const select = (rows: NetworkHistoryRow[], current = now) =>
    selectPreviousFinding(rows, 'asset:g1', 'tcp:23', current)

  it('dates a prohibited service that became uncertain, as a pending without weight', () => {
    const result = summarize([svc('tcp', 23, 'filtered')], {}, [row({})])
    assert.equal(result.compliance, null)
    assert.deepEqual(result.findings[0].previous, {
      result_id: row({}).id,
      check_key: 'network.telnet.confirmed',
      date: '2026-11-01T00:00:00.000Z',
      date_kind: 'observation',
    })
  })

  it('never reactivates a finding resolved later, and skips several uncertain observations', () => {
    const resolved = row({ id: 'b', status: 'compliant', reason_code: 'service_no_longer_observed', evaluated_at: '2026-11-05T00:00:00.000Z', observation: { ...trusted, observed_at: '2026-11-05T00:00:00.000Z' } })
    assert.equal(select([row({}), resolved]), null)
    assert.equal(select([row({})])?.check_key, 'network.telnet.confirmed')
  })

  it('ignores a compliant row it cannot trust: offline, partial coverage, unconfirmed or no snapshot', () => {
    const later = { evaluated_at: '2026-11-05T00:00:00.000Z', status: 'compliant', id: 'b' }
    for (const observation of [
      { ...trusted, asset_status: 'offline' },
      { ...trusted, port_scan: 'partial' as const },
      { ...trusted, authorization_status: 'pending' },
      null,
    ])
      assert.ok(select([row({}), row({ ...later, observation })]), JSON.stringify(observation))
    assert.equal(select([row({ observation: { ...trusted, asset_status: 'offline' } })]), null)
    assert.equal(select([row({ observation: null })]), null)
  })

  it('cuts by observation date, not by evaluation date', () => {
    // Evaluated after the current last_seen, but observed before it: still history.
    assert.ok(select([row({ evaluated_at: '2026-11-12T00:00:00.000Z' })]))
    // A reprocess of this very observation never selects itself.
    assert.equal(select([row({ observation: { ...trusted, observed_at: now } })]), null)
    assert.equal(select([row({})], null as unknown as string), null)
  })

  it('labels the evaluation date when the observation date is unknown', () => {
    assert.equal(select([row({ observation: { ...trusted, observed_at: null } })])?.date_kind, 'evaluation')
  })

  it('breaks an evaluation-date tie by insertion time, then by id', () => {
    const resolvedFirst = row({ id: 'a', status: 'compliant', createdAt: '2026-11-01T00:00:00.500Z' })
    const prohibitedLater = row({ id: 'b', createdAt: '2026-11-01T00:00:02.000Z' })
    assert.equal(select([resolvedFirst, prohibitedLater])?.result_id, 'b')
    const sameInstant = [row({ id: 'f' }), row({ id: '1' })]
    assert.deepEqual(sameInstant.sort(latestFirst).map(item => item.id), ['1', 'f'])
  })

  it('keeps a missing past prohibited port pending outside the covered range, resolved inside it', () => {
    const udp = row({ service_key: 'udp:161', check_key: 'network.service:udp:161' })
    const outside = summarize([], {}, [udp])
    assert.equal(outside.compliance, null)
    assert.equal(outside.findings[0].state, 'not_observed')
    assert.equal(outside.findings[0].previous?.result_id, udp.id)
    assert.equal(summarize([], {}, [row({})]).compliance, 1) // tcp:23 covered by 1-1000
  })

  it('decides absence exactly like the compliance-history loop', () => {
    const doc = observedDoc([svc('tcp', 23, 'closed')])
    const observation = networkObservation(doc)
    for (const key of ['tcp:23', 'tcp:80', 'tcp:5000', 'udp:161'])
      assert.equal(absenceConfirmed(observation, key), absenceConfirmed(doc, key), key)
  })
})
