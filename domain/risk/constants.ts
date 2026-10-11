export const RISK_ENGINE_VERSION = 2 as const

export const CRITICALITY_WEIGHTS = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
  unknown: 2,
} as const

export const SEVERITY_WEIGHTS = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
  unknown: 2,
} as const

export const EXPOSURE_WEIGHTS = { low: 1, medium: 2, high: 4 } as const
export const SCOPE_MULTIPLIERS = { local: 1, expanded: 1.5 } as const

export const CONTROL_RISK_CAP = 0.3
export const ASSESSMENT_EXCLUSION_MAX_DAYS = 90

export const COVERAGE_THRESHOLDS = {
  visible: 20,
  warning: 40,
  usable: 60,
  reliable: 80,
} as const

export const UNKNOWN_THRESHOLDS = { warning: 5, degradeConfidence: 15 } as const
export const SCORE_THRESHOLDS = { medium: 25, high: 50, critical: 75 } as const
export const SYSTEMIC_FAILURE_THRESHOLD = 20
export const SEVERE_CONCENTRATION_THRESHOLD = 30

export type Criticality = keyof typeof CRITICALITY_WEIGHTS
export type RiskSeverity = keyof typeof SEVERITY_WEIGHTS
export type Exposure = keyof typeof EXPOSURE_WEIGHTS
export type RiskBand = 'low' | 'medium' | 'high' | 'critical'
export type ConfidenceBand = 'hidden' | 'preliminary' | 'warning' | 'usable' | 'reliable'
export type PairStatus = 'compliant' | 'partially_effective' | 'non_compliant' | 'not_evaluable'

// Plan §3.8 visibility, keyed on the persisted coverage confidence (confidenceForCoverage): below
// COVERAGE_THRESHOLDS.visible no number is exposed, below .warning no band. The one rule every API,
// snapshot and page applies, so a threshold change never leaves a caller behind.
export const scoreVisible = (confidence: ConfidenceBand) => confidence !== 'hidden'
export const bandVisible = (confidence: ConfidenceBand) =>
  scoreVisible(confidence) && confidence !== 'preliminary'
