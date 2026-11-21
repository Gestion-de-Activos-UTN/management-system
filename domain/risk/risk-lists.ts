import { byCodePoint } from './answer-evidence'
import type { Criticality } from './constants'
import { CONTROL_IMPORTANCE } from './deficiency-index'
import type { EvaluationContext, PairEvidence, PairStatus } from './deficiency-pairs'
import type { PreviousFinding } from './network-evidence'
import { PRIORITY_RANK, maxPriority, type Priority, type Reason } from './priority'

// The two lists of contracts §7 (Plan §6, D24): Deficiencias with priority and Pendientes without
// it, grouped and in a fixed server order. Built from contribution rows, so persisted evaluations
// and live consolidations go through this same function.

/** What the lists read from a contribution (persisted row or `contributionFromPair` output). */
export type ListRow = {
  asset_key: string
  control_key: string
  criticality: Criticality
  compliance?: number | null
  status: PairStatus
  evidence: unknown
  reasons: unknown
}

export type SubjectRef =
  | { kind: 'asset'; asset_key: string; criticality: Criticality }
  | { kind: 'office'; id: string; affected_assets: number }
  | { kind: 'organization'; affected_assets: number }

export type ReasonView = Omit<Reason, 'source'> & {
  question_key?: string
  option_key?: string
  check_key?: string
  service_key?: string
  previous?: PreviousFinding // D26 context of a pending service, from the stored evidence
}

export type DeficiencyItem = {
  key: string
  control_key: string
  priority: Priority // never 'low': those only live in the detail of another item
  subject: SubjectRef
  compliance: number | null
  status: PairStatus
  reasons: ReasonView[]
}

export type PendingItem = {
  key: string
  group: 'survey' | 'control' // survey = A.5.9 / A.5.12 / A.8.16, «Estado del relevamiento»
  control_key: string
  importance: number | null // null in survey
  subject: SubjectRef
  reasons: ReasonView[]
}

// Survey block order (propuesta §6): classification first, then inventory, then visibility.
const SURVEY_ORDER: Readonly<Record<string, number>> = { 'A.5.12': 0, 'A.5.9': 1, 'A.8.16': 2 }
const CRITICALITY_RANK: Record<Criticality, number> = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 }

/** Natural order: A.5.15 < A.8.2 < A.8.9/A.8.20 < A.8.19 < A.8.20, independent of the locale. */
export function byControlKey(a: string, b: string): number {
  const parts = (key: string) => key.split(/(\d+)/)
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order =
      index % 2 === 1
        ? Number(left[index]) - Number(right[index])
        : byCodePoint(left[index], right[index])
    if (order) return order
  }
  return left.length - right.length
}

/** The reason key prefix names the subject: an inherited declaration is one item (contracts §4). */
const subjectKeyOf = (reasonKey: string) => reasonKey.split('|')[0]

type Group = {
  key: string
  subjectKey: string
  control_key: string
  rows: Set<ListRow>
  reasons: Map<string, ReasonView>
}

function reasonView(reason: Reason, evidence: PairEvidence | undefined): ReasonView {
  const { source, ...rest } = reason
  const view: ReasonView = { ...rest }
  if (source.kind === 'answer') {
    view.question_key = source.question_key
    view.option_key = source.option_key
  } else {
    view.check_key = source.check_key
    if (source.service_key) {
      view.service_key = source.service_key
      // The reason copies check and service from its own finding, so this always matches.
      const finding =
        evidence?.kind === 'network'
          ? evidence.findings.find(
              item => item.service_key === source.service_key && item.check_key === source.check_key
            )
          : undefined
      if (finding?.previous) view.previous = finding.previous
    }
  }
  return view
}

function subjectOf(group: Group): SubjectRef {
  const assets = new Set([...group.rows].map(row => row.asset_key).filter(Boolean))
  if (group.subjectKey === 'organization') return { kind: 'organization', affected_assets: assets.size }
  if (group.subjectKey.startsWith('office:'))
    return { kind: 'office', id: group.subjectKey.slice('office:'.length), affected_assets: assets.size }
  const [row] = group.rows
  return { kind: 'asset', asset_key: row.asset_key, criticality: row.criticality }
}

/** Sort-only: a shared subject orders by the most critical asset it reaches; priority never uses it. */
function criticalityOf(group: Group): number {
  return [...group.rows]
    .filter(row => row.asset_key)
    .reduce((top, row) => Math.max(top, CRITICALITY_RANK[row.criticality]), 0)
}

export function buildRiskLists(
  rows: readonly ListRow[],
  context: EvaluationContext,
  // Offices of the scope; a notice of another office never leaks into a consolidation.
  officeScope?: ReadonlySet<string>
): { deficiencies: DeficiencyItem[]; pending: PendingItem[] } {
  // Groups are built over every row and reason before any filter, so counts and criticality never
  // depend on which reasons end up in which list.
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const reasons = (row.reasons ?? []) as Reason[]
    for (const reason of reasons) {
      const subjectKey = subjectKeyOf(reason.key)
      const key = `${subjectKey}|${row.control_key}`
      let group = groups.get(key)
      if (!group) {
        group = { key, subjectKey, control_key: row.control_key, rows: new Set(), reasons: new Map() }
        groups.set(key, group)
      }
      group.rows.add(row)
      const view = reasonView(reason, row.evidence as PairEvidence | undefined)
      const known = group.reasons.get(reason.key)
      // The same shared reason on several assets is one reason; keep the highest priority.
      const higher =
        view.priority && (!known?.priority || PRIORITY_RANK[view.priority] > PRIORITY_RANK[known.priority])
      if (!known || higher) group.reasons.set(reason.key, view)
    }
  }

  // A.8.16 is one notice per office of the scope, from the evaluation context (fase 3).
  for (const item of context.office_visibility) {
    if (item.reason_code === 'agent_reporting') continue
    if (officeScope && !officeScope.has(item.office_id)) continue
    const subjectKey = `office:${item.office_id}`
    const reasonKey = `${subjectKey}|A.8.16|${item.reason_code}`
    groups.set(`${subjectKey}|A.8.16`, {
      key: `${subjectKey}|A.8.16`,
      subjectKey,
      control_key: 'A.8.16',
      rows: new Set(),
      reasons: new Map([
        [
          reasonKey,
          {
            key: reasonKey,
            list: 'pending',
            class: 'missing_information',
            priority: null,
            reason_code: item.reason_code,
            check_key: 'office.monitoring.active',
            adjustments: [],
          },
        ],
      ]),
    })
  }

  const deficiencies: Array<DeficiencyItem & { rank: number[] }> = []
  const pending: Array<PendingItem & { rank: number[] }> = []
  for (const group of groups.values()) {
    const reasons = [...group.reasons.values()].sort((a, b) => byCodePoint(a.key, b.key))
    const subject = subjectOf(group)
    const importance = CONTROL_IMPORTANCE[group.control_key] ?? null
    const criticality = criticalityOf(group)
    const priority = reasons
      .filter(reason => reason.list === 'deficiency' && !reason.subordinate_to)
      .reduce<Priority | null>((top, reason) => (top ? maxPriority(top, reason.priority!) : reason.priority), null)
    if (priority && priority !== 'low') {
      // Shared rows agree; if they ever differ, show the least favourable one.
      const worst = [...group.rows].reduce<ListRow | undefined>(
        (low, row) =>
          !low || (row.compliance ?? Infinity) < (low.compliance ?? Infinity) ? row : low,
        undefined
      )
      deficiencies.push({
        key: group.key,
        control_key: group.control_key,
        priority,
        subject,
        compliance: worst?.compliance ?? null,
        status: worst?.status ?? 'not_evaluable',
        reasons,
        rank: [-PRIORITY_RANK[priority], -(importance ?? 0), -criticality],
      })
    }
    const pendingReasons = reasons.filter(reason => reason.list === 'pending')
    if (pendingReasons.length) {
      const survey = group.control_key in SURVEY_ORDER
      pending.push({
        key: group.key,
        group: survey ? 'survey' : 'control',
        control_key: group.control_key,
        importance: survey ? null : importance,
        subject,
        reasons: pendingReasons,
        rank: survey
          ? [0, SURVEY_ORDER[group.control_key], 0, 0]
          : [1, 0, -(importance ?? 0), -criticality],
      })
    }
  }

  const order = <T extends { rank: number[]; control_key: string; key: string }>(a: T, b: T) => {
    for (let index = 0; index < a.rank.length; index += 1)
      if (a.rank[index] !== b.rank[index]) return a.rank[index] - b.rank[index]
    return byControlKey(a.control_key, b.control_key) || byCodePoint(a.key, b.key)
  }
  const strip = <T extends { rank: number[] }>({ rank: _rank, ...item }: T) => item
  return {
    deficiencies: deficiencies.sort(order).map(strip),
    pending: pending.sort(order).map(strip),
  }
}
