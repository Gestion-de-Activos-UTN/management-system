import type { ComplianceStatus } from './catalog'

/**
 * Single efficacy → status mapping for assessment answers and controls. A justified
 * `not_applicable` is its own state, never `not_evaluable` (missing information).
 */
export function complianceStatusFor(efficacy: number | null, notApplicable = false): ComplianceStatus {
  if (notApplicable) return 'not_applicable'
  if (efficacy === null) return 'not_evaluable'
  if (efficacy === 1) return 'compliant'
  if (efficacy === 0) return 'non_compliant'
  return 'partially_effective'
}
