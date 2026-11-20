import { byCodePoint } from './answer-evidence'
import { RISK_CATALOG_VERSION, RISK_ENGINE_VERSION } from './constants'
import type { RiskPolicyKey } from './catalog-v2'
import {
  INDEX_EXCLUDED_CONTROLS,
  calculateDeficiencyIndex,
  type ControlIndex,
  type IndexBand,
  type IndexVisibility,
} from './deficiency-index'
import type { AssetCounts, DeficiencyPair, EvaluationContext, PairStatus } from './deficiency-pairs'
import { countDeficiencies, countPendingServices, type Priority } from './priority'

export type EvaluationCounts = {
  pairs: Record<PairStatus, number> // index controls only
  assets: AssetCounts // overlapping dimensions, never summed
  deficiencies: Record<Priority, number> // unique reasons; shared declarations count once
  network: { pending_services: number; assets_with_pending_services: number }
}

export type AssetIndex = {
  asset_key: string
  index: number | null
  coverage: number | null
  visibility: IndexVisibility
  band: IndexBand | null
}

export type ControlWarning = Pick<ControlIndex, 'control_key' | 'importance' | 'coverage' | 'pending_pairs'>

/** Evaluation fields (contracts §5), shared by persisted evaluations and live consolidations. */
export type EvaluationData = {
  catalog_version: number
  engine_version: number
  policy_key: RiskPolicyKey
  index: number | null
  band: IndexBand | null
  coverage: number | null
  visibility: IndexVisibility
  control_summary: ControlIndex[]
  warnings: ControlWarning[]
  asset_summary: AssetIndex[]
  counts: EvaluationCounts
  context: EvaluationContext
}

const STATUSES: readonly PairStatus[] = [
  'compliant',
  'partially_effective',
  'non_compliant',
  'not_evaluable',
  'not_applicable',
]

export function evaluationFromPairs(input: {
  policy: RiskPolicyKey
  pairs: readonly DeficiencyPair[]
  assetCounts: AssetCounts
  context: EvaluationContext
}): EvaluationData {
  const { pairs } = input
  const result = calculateDeficiencyIndex(pairs)

  const pairCounts = Object.fromEntries(STATUSES.map(status => [status, 0])) as Record<PairStatus, number>
  for (const pair of pairs) if (!INDEX_EXCLUDED_CONTROLS.has(pair.control_key)) pairCounts[pair.status] += 1

  // An asset's index is calculated over its own pairs, never averaged from controls.
  const byAsset = new Map<string, DeficiencyPair[]>()
  for (const pair of pairs) {
    const group = byAsset.get(pair.asset_key)
    if (group) group.push(pair)
    else byAsset.set(pair.asset_key, [pair])
  }
  const assetSummary = [...byAsset.entries()]
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([assetKey, assetPairs]) => {
      const asset = calculateDeficiencyIndex(assetPairs)
      return {
        asset_key: assetKey,
        index: asset.index,
        coverage: asset.coverage,
        visibility: asset.visibility,
        band: asset.band,
      }
    })

  const network = countPendingServices(pairs)
  return {
    catalog_version: RISK_CATALOG_VERSION,
    engine_version: RISK_ENGINE_VERSION,
    policy_key: input.policy,
    index: result.index,
    band: result.band,
    coverage: result.coverage,
    visibility: result.visibility,
    control_summary: result.controls,
    warnings: result.controls
      .filter(control => control.warning)
      .map(({ control_key, importance, coverage, pending_pairs }) => ({
        control_key,
        importance,
        coverage,
        pending_pairs,
      })),
    asset_summary: assetSummary,
    counts: {
      pairs: pairCounts,
      assets: input.assetCounts,
      deficiencies: countDeficiencies(pairs),
      network: {
        pending_services: network.services,
        assets_with_pending_services: network.assets,
      },
    },
    context: input.context,
  }
}
