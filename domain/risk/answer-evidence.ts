import type { ComplianceResult } from '@/app/types/payload-types'
import type {
  EvaluationEffectSnapshot,
  SubEfficacySnapshot,
} from '@/domain/assessments/assessmentLifecycle'
import { relationId } from '@/lib/relationId'
import type { QuestionScope } from './catalog-v2/types'

/** One combined human answer per control, as stored by the Assessment closing (contracts §2.1). */
export type AnswerEvidence = {
  control_key: string
  origin: 'asset' | 'office' | 'organization'
  asset_key: string | null // only when origin = 'asset'
  office_id: string | null // office of the row when answered (also for asset answers); null for organization
  applicability: 'applicable' | 'not_applicable'
  compliance: number | null
  sub: SubEfficacySnapshot[]
  applied_rules: string[]
  assessment_id: string
  result_id: string
  completed_at: string
}

/** The one asset key format shared by answers and loaded assets: `asset:<id>` | `manual:<id>`. */
export function assetKey(row: { asset?: unknown; manual_asset?: unknown }): string | null {
  if (row.asset) return `asset:${relationId(row.asset)}`
  if (row.manual_asset) return `manual:${relationId(row.manual_asset)}`
  return null
}

// States that never carry a score, whatever the snapshot's combined_efficacy says.
const UNSCORED_STATUSES: ReadonlySet<string> = new Set(['not_evaluable', 'not_applicable'])

export function answerEvidence(row: ComplianceResult): AnswerEvidence {
  const snapshot = (row.evidence_snapshot ?? {}) as {
    assessment_id?: unknown
    evaluation_effect?: Partial<EvaluationEffectSnapshot>
  }
  const effect = snapshot.evaluation_effect ?? {}
  const key = assetKey(row)
  return {
    control_key: row.control_key,
    origin: key ? 'asset' : row.office ? 'office' : 'organization',
    asset_key: key,
    office_id: row.office ? relationId(row.office) : null,
    applicability: row.status === 'not_applicable' ? 'not_applicable' : 'applicable',
    compliance:
      UNSCORED_STATUSES.has(row.status) || typeof effect.combined_efficacy !== 'number'
        ? null
        : effect.combined_efficacy,
    sub: Array.isArray(effect.sub_efficacies) ? effect.sub_efficacies : [],
    applied_rules: Array.isArray(effect.applied_rules) ? effect.applied_rules : [],
    assessment_id: String(snapshot.assessment_id ?? ''),
    result_id: String(row.id),
    completed_at: row.evaluated_at,
  }
}

// Code-point order, never locale-dependent. Ids are UUIDs and dates ISO 8601 UTC, both sortable as text.
export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Most recent closing first; an exact tie falls back to the lowest result id (contracts §8). */
const newestFirst = (a: AnswerEvidence, b: AnswerEvidence) =>
  byCodePoint(b.completed_at, a.completed_at) || byCodePoint(a.result_id, b.result_id)

/**
 * Picks the answer that applies to one asset–control pair: own asset answer, then its office, then
 * the organization. Asset-scoped controls never inherit (contracts §3).
 */
export function selectAnswer(
  candidates: readonly AnswerEvidence[],
  target: { control_key: string; asset_key: string; office_id: string; scope: QuestionScope }
): AnswerEvidence | undefined {
  const forControl = candidates.filter(item => item.control_key === target.control_key)
  const pick = (matches: (item: AnswerEvidence) => boolean) =>
    forControl.filter(matches).sort(newestFirst)[0]
  const own = pick(item => item.origin === 'asset' && item.asset_key === target.asset_key)
  if (own || target.scope === 'asset') return own
  return (
    pick(item => item.origin === 'office' && item.office_id === target.office_id) ??
    pick(item => item.origin === 'organization')
  )
}
