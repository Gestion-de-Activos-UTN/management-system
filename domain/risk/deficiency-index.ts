import { BAND_THRESHOLDS, CRITICALITY_WEIGHTS, type Criticality } from './constants'

// Plan índice-deficiencias §3 (D20): fixed importance per control. A.5.9/A.5.12/A.8.16 stay out of
// both index and coverage (inventory preparation / per-office visibility notice, D22).
export const CONTROL_IMPORTANCE: Readonly<Record<string, number>> = {
  'A.8.2': 8,
  'A.5.15': 4,
  'A.8.7': 4,
  'A.8.8': 4,
  'A.8.9/A.8.20': 4,
  'A.8.13': 4,
  'A.8.20': 4,
  'A.8.22': 4,
  'A.7.9': 2,
  'A.8.1': 2,
  'A.8.5': 2,
  'A.8.15': 2,
  'A.8.19': 2,
  'A.8.21': 2,
  'A.5.25': 1,
}
export const INDEX_EXCLUDED_CONTROLS: ReadonlySet<string> = new Set(['A.5.9', 'A.5.12', 'A.8.16'])

// Initial values (D13/D21), checked for coherence on seed and a synthetic sweep in fase 8; not
// validated with real data and not normative.
export const VISIBILITY_THRESHOLDS = { preliminary: 40, banded: 80 } as const
export const CONTROL_WARNING = { minImportance: 4, belowCoverage: 80 } as const

export type IndexBand = 'low' | 'moderate' | 'high' | 'very_high'
export type IndexVisibility = 'undetermined' | 'hidden' | 'preliminary' | 'banded'

/** One applicable, scoreable asset–control pair. `compliance` null = not evaluable. */
export type IndexPair = {
  control_key: string
  criticality: Criticality
  compliance: number | null
  // A justified not-applicable pair leaves P_c: it never weighs on index or coverage (Plan §3).
  applicability?: 'applicable' | 'not_applicable'
}

export type ControlIndex = {
  control_key: string
  importance: number
  deficiency: number | null // D_c in [0,1]
  coverage: number // cob_c in [0,1]
  evaluated_pairs: number
  pending_pairs: number
  warning: boolean
}

export type DeficiencyIndexResult = {
  index: number | null // 0–100
  coverage: number | null // 0–100
  visibility: IndexVisibility
  band: IndexBand | null // only when visibility is 'banded'
  controls: ControlIndex[]
}

export const bandForIndex = (index: number): IndexBand =>
  index >= BAND_THRESHOLDS.veryHigh
    ? 'very_high'
    : index >= BAND_THRESHOLDS.high
      ? 'high'
      : index >= BAND_THRESHOLDS.moderate
        ? 'moderate'
        : 'low'

/**
 * The one read rule for every API, field access, snapshot and page: the index (and D_c, asset
 * indexes) from 40 % coverage, the band from 80 % (Plan §6).
 */
export const indexVisible = (visibility: IndexVisibility | null | undefined) =>
  visibility === 'preliminary' || visibility === 'banded'
export const bandVisible = (visibility: IndexVisibility | null | undefined) => visibility === 'banded'

export const visibilityForCoverage = (coverage: number | null): IndexVisibility =>
  coverage === null
    ? 'undetermined'
    : coverage < VISIBILITY_THRESHOLDS.preliminary
      ? 'hidden'
      : coverage < VISIBILITY_THRESHOLDS.banded
        ? 'preliminary'
        : 'banded'

/**
 * B pura: criticality weighs inside a control, importance between controls; coverage is reported
 * beside the index, never multiplied into it (D21). Same function for asset, office and
 * organization: callers pass the union of pairs of that population, never averaged indexes.
 */
export function calculateDeficiencyIndex(
  pairs: readonly IndexPair[],
  importance: Readonly<Record<string, number>> = CONTROL_IMPORTANCE
): DeficiencyIndexResult {
  const sums = new Map<string, { applicable: number; evaluated: number; deficient: number; n: number; e: number }>()
  for (const pair of pairs) {
    if (INDEX_EXCLUDED_CONTROLS.has(pair.control_key) || pair.applicability === 'not_applicable')
      continue
    if (importance[pair.control_key] === undefined)
      throw new Error(`Control sin importancia: ${pair.control_key}`)
    const weight = CRITICALITY_WEIGHTS[pair.criticality]
    const sum = sums.get(pair.control_key) ?? { applicable: 0, evaluated: 0, deficient: 0, n: 0, e: 0 }
    sum.applicable += weight
    sum.n += 1
    if (pair.compliance !== null) {
      sum.evaluated += weight
      sum.deficient += weight * (1 - pair.compliance)
      sum.e += 1
    }
    sums.set(pair.control_key, sum)
  }

  const controls = [...sums]
    .map<ControlIndex>(([controlKey, sum]) => {
      const coverage = sum.evaluated / sum.applicable
      return {
        control_key: controlKey,
        importance: importance[controlKey],
        deficiency: sum.e === 0 ? null : sum.deficient / sum.evaluated,
        coverage,
        evaluated_pairs: sum.e,
        pending_pairs: sum.n - sum.e,
        warning:
          importance[controlKey] >= CONTROL_WARNING.minImportance &&
          coverage * 100 < CONTROL_WARNING.belowCoverage,
      }
    })
    .sort((a, b) => b.importance - a.importance || a.control_key.localeCompare(b.control_key))

  const evaluated = controls.filter(control => control.deficiency !== null)
  const evaluatedImportance = evaluated.reduce((total, control) => total + control.importance, 0)
  const index =
    evaluated.length === 0
      ? null
      : (100 *
          evaluated.reduce((total, control) => total + control.importance * control.deficiency!, 0)) /
        evaluatedImportance
  const applicableImportance = controls.reduce((total, control) => total + control.importance, 0)
  const coverage =
    controls.length === 0
      ? null
      : (100 * controls.reduce((total, control) => total + control.importance * control.coverage, 0)) /
        applicableImportance
  const visibility = visibilityForCoverage(coverage)
  return {
    index,
    coverage,
    visibility,
    band: visibility === 'banded' && index !== null ? bandForIndex(index) : null,
    controls,
  }
}
