import type { Asset, ComplianceResult } from '@/app/types/payload-types'
import {
  evaluateNetworkBaseline,
  type NetworkEvaluation,
} from '@/domain/assessments/evaluateNetworkBaseline'
import { absenceConfirmed } from '@/domain/inventories/port-coverage'
import { assetKey, byCodePoint } from './answer-evidence'

// A.8.21 evidence for the deficiency index (Plan §4.1, D25/D26; contracts §2.2, §4.2, §4.3).

type Coverage = 'complete' | 'partial' | 'not_attempted' | 'unknown'

/** What a network result knew about its observation; stored in compliance-results snapshots. */
export type ObservationSnapshot = {
  observed_at: string | null // assets.last_seen
  asset_status: string
  identified: boolean
  authorization_status: string
  port_scan: Coverage
  service_detection: Coverage
}

export type NetworkObservation = ObservationSnapshot & {
  coverage_complete: boolean // scan techniques only, never the state of the services
  port_scan_coverage: unknown
  services: NonNullable<Asset['services']>
  evaluations: NetworkEvaluation[]
}

export type PreviousFinding = {
  result_id: string
  check_key: string
  date: string
  date_kind: 'observation' | 'evaluation'
}

export type NetworkServiceFinding = {
  service_key: string // 'tcp:23'
  check_key: string
  reason_code: string
  state: string // scanner state, or 'not_observed' for a past finding missing from this scan
  baseline: 'prohibited' | 'review' | 'unmatched' | 'uncertain' | 'insufficient_confidence'
  confidence: number | null
  severity: NetworkEvaluation['severity']
  evidence: { name?: string; product?: string; version?: string; tunnel?: string }
  previous?: PreviousFinding // pending findings only (D26)
}

export type NetworkPairEvidence = Omit<ObservationSnapshot, 'identified' | 'authorization_status'> & {
  coverage_complete: boolean
  expected_count: number
  closed_count: number
}

export type NetworkHistoryRow = {
  id: string
  createdAt: string
  evaluated_at: string
  asset_key: string
  service_key: string
  check_key: string
  status: string
  reason_code: string
  observation: ObservationSnapshot | null
}

export function observationSnapshot(
  doc: Pick<Asset, 'last_seen' | 'status' | 'identified' | 'authorization_status' | 'asset_coverage'>
): ObservationSnapshot {
  return {
    observed_at: doc.last_seen ?? null,
    asset_status: doc.status ?? 'active',
    identified: Boolean(doc.identified),
    authorization_status: doc.authorization_status ?? 'pending',
    port_scan: doc.asset_coverage?.port_scan ?? 'unknown',
    service_detection: doc.asset_coverage?.service_detection ?? 'unknown',
  }
}

export function networkObservation(doc: Asset): NetworkObservation {
  const snapshot = observationSnapshot(doc)
  return {
    ...snapshot,
    coverage_complete: snapshot.port_scan === 'complete' && snapshot.service_detection === 'complete',
    port_scan_coverage: doc.port_scan_coverage,
    services: doc.services ?? [],
    evaluations: evaluateNetworkBaseline({
      confirmed_type: doc.confirmed_type ?? null,
      port_coverage: snapshot.port_scan,
      service_coverage: snapshot.service_detection,
      services: doc.services ?? [],
    }),
  }
}

export function networkHistoryRow(row: ComplianceResult): NetworkHistoryRow {
  const snapshot = (row.evidence_snapshot ?? {}) as { observation?: ObservationSnapshot }
  return {
    id: String(row.id),
    createdAt: row.createdAt,
    evaluated_at: row.evaluated_at,
    asset_key: assetKey(row) ?? '',
    service_key: row.service_key ?? '',
    check_key: row.check_key,
    status: row.status,
    reason_code: row.reason_code,
    observation: snapshot.observation ?? null,
  }
}

/** Newest first: evaluation date, then real insertion time, then id (contracts §8). */
export const latestFirst = (
  a: { evaluated_at: string; createdAt: string; id: string | number },
  b: { evaluated_at: string; createdAt: string; id: string | number }
) =>
  Date.parse(b.evaluated_at) - Date.parse(a.evaluated_at) ||
  Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
  byCodePoint(String(a.id), String(b.id))

// A row proves a finding or its resolution only if its own observation was trustworthy.
const eligible = (observation: ObservationSnapshot | null): observation is ObservationSnapshot =>
  observation !== null &&
  observation.asset_status !== 'offline' &&
  observation.identified &&
  observation.authorization_status !== 'pending' &&
  observation.port_scan === 'complete' &&
  observation.service_detection === 'complete'

/**
 * D26: the last confirmed prohibited result of the same asset and service, from an earlier
 * observation, with no confirmed resolution after it. Context only: no priority, no weight.
 */
export function selectPreviousFinding(
  rows: readonly NetworkHistoryRow[],
  assetKeyValue: string,
  serviceKey: string,
  currentObservedAt: string | null
): PreviousFinding | null {
  if (!currentObservedAt) return null
  const current = Date.parse(currentObservedAt)
  const sequence = rows
    .filter(
      row =>
        row.asset_key === assetKeyValue &&
        row.service_key === serviceKey &&
        eligible(row.observation) &&
        // Cut by observation, never by evaluation date: a late evaluation of an earlier scan is
        // still history, and a reprocess of this same scan is not.
        (row.observation.observed_at === null || Date.parse(row.observation.observed_at) < current)
    )
    .sort(latestFirst)
  for (const row of sequence) {
    if (row.status === 'compliant') return null
    if (row.status === 'non_compliant' && row.reason_code === 'network_prohibited') {
      const observedAt = row.observation!.observed_at
      return {
        result_id: row.id,
        check_key: row.check_key,
        date: observedAt ?? row.evaluated_at,
        date_kind: observedAt ? 'observation' : 'evaluation',
      }
    }
  }
  return null
}

/** Protocol, then numeric port: tcp:23 before tcp:161, tcp:53 before udp:53. */
const byService = (a: string, b: string) => {
  const [protocolA, portA] = a.split(':')
  const [protocolB, portB] = b.split(':')
  return byCodePoint(protocolA, protocolB) || Number(portA) - Number(portB) || byCodePoint(a, b)
}

const BASELINE: Record<string, NetworkServiceFinding['baseline']> = {
  network_prohibited: 'prohibited',
  network_review: 'review',
  service_unclassified: 'unmatched',
  service_confidence_insufficient: 'insufficient_confidence',
}

const findingOf = (evaluation: NetworkEvaluation): NetworkServiceFinding => ({
  service_key: evaluation.service_key,
  check_key: evaluation.check_key,
  reason_code: evaluation.reason_code,
  state: evaluation.evidence.state ?? 'unknown',
  baseline: BASELINE[evaluation.reason_code] ?? 'uncertain',
  confidence: evaluation.evidence.confidence ?? null,
  severity: evaluation.severity,
  // Raw scripts stay in the asset; the finding only names the service.
  evidence: Object.fromEntries(
    (['name', 'product', 'version', 'tunnel'] as const).flatMap(field =>
      evaluation.evidence[field] ? [[field, evaluation.evidence[field]]] : []
    )
  ),
})

/**
 * One A.8.21 pair per asset (Plan §4.1 matrix): blockers first, then any valid prohibited service
 * scores 0 while uncertain ones stay pending beside it; no prohibited and something pending is
 * null; only expected services, or none open, is 1.
 */
export function summarizeNetwork(
  observation: NetworkObservation,
  assetKeyValue: string,
  history: readonly NetworkHistoryRow[] = []
): {
  compliance: 0 | 1 | null
  reason_code: string
  findings: NetworkServiceFinding[]
  evidence: NetworkPairEvidence
} {
  const evidence: NetworkPairEvidence = {
    observed_at: observation.observed_at,
    asset_status: observation.asset_status,
    port_scan: observation.port_scan,
    service_detection: observation.service_detection,
    coverage_complete: observation.coverage_complete,
    expected_count: observation.evaluations.filter(item => item.reason_code === 'network_expected').length,
    closed_count: observation.services.filter(service => service.state === 'closed').length,
  }
  if (observation.asset_status === 'offline')
    return { compliance: null, reason_code: 'scan_missing_or_incomplete', findings: [], evidence }
  if (!observation.coverage_complete)
    return { compliance: null, reason_code: 'technical_coverage_insufficient', findings: [], evidence }

  const findings = new Map<string, NetworkServiceFinding>()
  for (const evaluation of observation.evaluations)
    if (evaluation.reason_code !== 'network_expected')
      findings.set(`${evaluation.service_key}|${evaluation.check_key}`, findingOf(evaluation))

  const rows = history.filter(row => row.asset_key === assetKeyValue)
  const observed = new Set(observation.evaluations.map(item => item.service_key))
  // A past prohibited service missing from this scan is resolved only by a confirmed absence.
  for (const serviceKey of new Set(rows.map(row => row.service_key))) {
    if (observed.has(serviceKey) || absenceConfirmed(observation, serviceKey)) continue
    const previous = selectPreviousFinding(rows, assetKeyValue, serviceKey, observation.observed_at)
    if (previous)
      findings.set(`${serviceKey}|network.service:${serviceKey}`, {
        service_key: serviceKey,
        check_key: `network.service:${serviceKey}`,
        reason_code: 'service_state_unconfirmed',
        state: 'not_observed',
        baseline: 'uncertain',
        confidence: null,
        severity: 'medium',
        evidence: {},
        previous,
      })
  }
  for (const finding of findings.values())
    if (finding.baseline !== 'prohibited' && !finding.previous) {
      const previous = selectPreviousFinding(rows, assetKeyValue, finding.service_key, observation.observed_at)
      if (previous) finding.previous = previous
    }

  const sorted = [...findings.values()].sort(
    (a, b) => byService(a.service_key, b.service_key) || byCodePoint(a.check_key, b.check_key)
  )
  if (sorted.some(finding => finding.baseline === 'prohibited'))
    return { compliance: 0, reason_code: 'network_prohibited', findings: sorted, evidence }
  if (sorted.length)
    return { compliance: null, reason_code: 'network_review_required', findings: sorted, evidence }
  return { compliance: 1, reason_code: 'network_expected', findings: sorted, evidence }
}
