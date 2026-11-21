import type { ComplianceStatus } from '@/domain/assessments/catalog'
import { complianceStatusFor } from '@/domain/assessments/compliance-status'
import { byCodePoint, selectAnswer, type AnswerEvidence } from './answer-evidence'
import { classificationEfficacy, inventoryEfficacy, shadowItEfficacy } from './automatic-evidence'
import { RISK_CONTROLS_V2, RISK_QUESTIONS_V2 } from './catalog-v2'
import type { QuestionScope, RiskAssetType, RiskPolicyKey } from './catalog-v2/types'
import type { Criticality } from './constants'
import {
  summarizeNetwork,
  type NetworkHistoryRow,
  type NetworkObservation,
  type NetworkPairEvidence,
  type NetworkServiceFinding,
} from './network-evidence'
import { pairPriority, pairReasons, type Priority, type Reason } from './priority'

export type RiskInputAsset = {
  key: string // `asset:<id>` or `manual:<id>`
  source: 'network' | 'manual'
  office_id: string
  risk_type: RiskAssetType | null
  criticality: Criticality
  identified: boolean
  authorization_status: 'authorized' | 'unauthorized' | 'pending'
  has_owner: boolean
  cidr: string | null
  excluded: boolean
  observation: NetworkObservation | null // network assets only (D25)
}

export type RiskOfficeMonitoring = {
  office_id: string
  efficacy: number | null
  reason_code: string
}

type QuestionControl = {
  key: string
  scope: QuestionScope
  asset_types: ReadonlySet<RiskAssetType> | null // null = every asset with a risk type
}

/** Controls answered by questions under a policy; the catalog guarantees one scope per control. */
export function questionControls(policy: RiskPolicyKey): QuestionControl[] {
  return RISK_CONTROLS_V2.flatMap(control => {
    const questions = RISK_QUESTIONS_V2.filter(
      question => question.control_key === control.key && question.policies.includes(policy)
    )
    if (!questions.length) return []
    const unrestricted = questions.some(question => !question.asset_types)
    return [
      {
        key: control.key,
        scope: questions[0].scope,
        asset_types: unrestricted
          ? null
          : new Set(questions.flatMap(question => question.asset_types ?? [])),
      },
    ]
  })
}

/** The same five states as compliance-results, so one name travels through every layer. */
export type PairStatus = ComplianceStatus

export type PairEvidence =
  | { kind: 'answer'; answer: AnswerEvidence }
  | { kind: 'answer_missing' }
  | { kind: 'automatic'; check_key: string }
  // One A.8.21 pair per asset; services are evidence of the pair, never extra pairs (D25).
  | { kind: 'network'; observation: NetworkPairEvidence | null; findings: NetworkServiceFinding[] }

/** One asset–control pair of the deficiency index (contracts §3). */
export type DeficiencyPair = {
  asset_key: string
  asset_office_id: string
  asset_type: RiskAssetType | null
  control_key: string
  criticality: Criticality
  applicability: 'applicable' | 'not_applicable'
  compliance: number | null
  status: PairStatus
  reason_code: string
  evidence: PairEvidence
  reasons: Reason[] // why it falls short or what is missing (priority.ts)
  priority: Priority | null // highest non-subordinate deficiency reason
}

/** Overlapping dimensions: an asset can count in several, so they are never summed. */
export type AssetCounts = {
  in_scope: number
  excluded_from_assessment: number
  unidentified: number
  authorization_pending: number
  unauthorized: number
}

export type EvaluationContext = {
  office_visibility: Array<{ office_id: string; reason_code: string }>
  shared_cidr: Array<{
    office_id: string
    cidr: string
    unidentified_assets: number
    important_assets: string[]
  }>
}

/**
 * Builds every applicable pair before deciding evaluability, so missing evidence stays in the
 * coverage denominator. No exposure, scope or severity: B pura only weighs criticality inside a
 * control (contracts §3).
 */
export function buildDeficiencyPairs(input: {
  organizationId: string
  policy: RiskPolicyKey
  assets: readonly RiskInputAsset[]
  answers: readonly AnswerEvidence[]
  monitoring: readonly RiskOfficeMonitoring[]
  networkHistory?: readonly NetworkHistoryRow[]
}): { pairs: DeficiencyPair[]; assetCounts: AssetCounts; context: EvaluationContext } {
  const monitoring = new Map(input.monitoring.map(item => [item.office_id, item]))
  const controls = questionControls(input.policy)
  const pairs: DeficiencyPair[] = []

  for (const asset of input.assets) {
    // Unidentified or pending assets add no evaluable weight until confirmed (Reglas Globales §5.2).
    const unconfirmed =
      asset.source === 'network' && (!asset.identified || asset.authorization_status === 'pending')
    const push = (
      controlKey: string,
      value: { compliance: number | null; reason_code: string; evidence: PairEvidence },
      applicability: DeficiencyPair['applicability'] = 'applicable'
    ) => {
      const gated = unconfirmed
        ? { compliance: null, reason_code: 'asset_unconfirmed', applicability: 'applicable' as const }
        : { compliance: value.compliance, reason_code: value.reason_code, applicability }
      const pair: DeficiencyPair = {
        asset_key: asset.key,
        asset_office_id: asset.office_id,
        asset_type: asset.risk_type,
        control_key: controlKey,
        criticality: asset.criticality,
        applicability: gated.applicability,
        compliance: gated.compliance,
        status: complianceStatusFor(gated.compliance, gated.applicability === 'not_applicable'),
        reason_code: gated.reason_code,
        evidence: value.evidence,
        reasons: [],
        priority: null,
      }
      pair.reasons = pairReasons(pair)
      pair.priority = pairPriority(pair.reasons)
      pairs.push(pair)
    }

    // Automatic pairs first: an exclusion from Assessment never removes them.
    push('A.5.9', {
      compliance: inventoryEfficacy(asset.identified, asset.has_owner, asset.authorization_status),
      reason_code: 'inventory_completeness',
      evidence: { kind: 'automatic', check_key: 'asset.inventory.complete' },
    })
    push('A.5.12', {
      compliance: classificationEfficacy(asset.criticality),
      reason_code: 'criticality_assignment',
      evidence: { kind: 'automatic', check_key: 'asset.classification.present' },
    })
    if (asset.source === 'network') {
      const network = asset.observation
        ? summarizeNetwork(asset.observation, asset.key, input.networkHistory)
        : null
      const office = monitoring.get(asset.office_id)
      push('A.8.20', {
        compliance: shadowItEfficacy(asset.identified, asset.authorization_status),
        reason_code: 'authorization_status',
        evidence: { kind: 'automatic', check_key: 'asset.authorization.status' },
      })
      push('A.8.21', {
        compliance: network?.compliance ?? null,
        reason_code: network?.reason_code ?? 'scan_missing_or_incomplete',
        evidence: {
          kind: 'network',
          observation: network?.evidence ?? null,
          findings: network?.findings ?? [],
        },
      })
      push('A.8.16', {
        compliance: office?.efficacy ?? null,
        reason_code: office?.reason_code ?? 'agent_missing',
        evidence: { kind: 'automatic', check_key: 'office.monitoring.active' },
      })
    }

    if (!asset.risk_type || asset.excluded) continue
    for (const control of controls) {
      if (control.asset_types && !control.asset_types.has(asset.risk_type)) continue
      const answer = selectAnswer(input.answers, {
        control_key: control.key,
        asset_key: asset.key,
        office_id: asset.office_id,
        scope: control.scope,
      })
      if (!answer) {
        push(control.key, {
          compliance: null,
          reason_code: 'answer_missing',
          evidence: { kind: 'answer_missing' },
        })
        continue
      }
      const notApplicable = answer.applicability === 'not_applicable'
      push(
        control.key,
        {
          compliance: notApplicable ? null : answer.compliance,
          reason_code: notApplicable
            ? 'not_applicable'
            : answer.compliance === null
              ? 'not_evaluable'
              : 'evaluable',
          evidence: { kind: 'answer', answer },
        },
        answer.applicability
      )
    }
  }

  pairs.sort(
    (a, b) => byCodePoint(a.asset_key, b.asset_key) || byCodePoint(a.control_key, b.control_key)
  )
  return { pairs, assetCounts: countAssets(input.assets), context: buildContext(input) }
}

export function countAssets(assets: readonly RiskInputAsset[]): AssetCounts {
  const count = (matches: (asset: RiskInputAsset) => boolean) => assets.filter(matches).length
  return {
    in_scope: assets.length,
    excluded_from_assessment: count(asset => asset.excluded),
    unidentified: count(asset => !asset.identified),
    authorization_pending: count(asset => asset.authorization_status === 'pending'),
    unauthorized: count(asset => asset.authorization_status === 'unauthorized'),
  }
}

/**
 * A.8.16 becomes one notice per office instead of a pair per asset; shared-CIDR context is keyed by
 * office + CIDR, because the same private range in two offices is not the same network.
 */
function buildContext(input: {
  assets: readonly RiskInputAsset[]
  monitoring: readonly RiskOfficeMonitoring[]
}): EvaluationContext {
  const groups = new Map<string, { office_id: string; cidr: string; unknown: number; important: string[] }>()
  for (const asset of input.assets) {
    if (asset.source !== 'network' || !asset.cidr) continue
    const key = `${asset.office_id}|${asset.cidr}`
    const group = groups.get(key) ?? { office_id: asset.office_id, cidr: asset.cidr, unknown: 0, important: [] }
    if (!asset.identified) group.unknown += 1
    else if (asset.criticality === 'high' || asset.criticality === 'critical')
      group.important.push(asset.key)
    groups.set(key, group)
  }
  return {
    office_visibility: input.monitoring
      .map(item => ({ office_id: item.office_id, reason_code: item.reason_code }))
      .sort((a, b) => byCodePoint(a.office_id, b.office_id)),
    shared_cidr: [...groups.values()]
      .filter(group => group.unknown > 0 && group.important.length > 0)
      .map(group => ({
        office_id: group.office_id,
        cidr: group.cidr,
        unidentified_assets: group.unknown,
        important_assets: group.important.sort(byCodePoint),
      }))
      .sort((a, b) => byCodePoint(a.office_id, b.office_id) || byCodePoint(a.cidr, b.cidr)),
  }
}
