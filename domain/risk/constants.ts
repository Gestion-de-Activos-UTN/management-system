export const RISK_ENGINE_VERSION = 3 as const
export const RISK_CATALOG_VERSION = 2 as const

/** Weight of an asset inside a control (B pura): criticality only, unknown counts as medium. */
export const CRITICALITY_WEIGHTS = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
  unknown: 2,
} as const

export const ASSESSMENT_EXCLUSION_MAX_DAYS = 90

/** Index bands [0,25) low, [25,50) moderate, [50,75) high, [75,100] very high (Plan §6). */
export const BAND_THRESHOLDS = { moderate: 25, high: 50, veryHigh: 75 } as const

// Tamaños de página de "Qué necesita atención": acotados para que el endpoint no pagine sin límite.
export const RISK_PAGE_SIZES = [10, 25, 50] as const
export const RISK_DEFAULT_PAGE_SIZE = 25

export type Criticality = keyof typeof CRITICALITY_WEIGHTS
