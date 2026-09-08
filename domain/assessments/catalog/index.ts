import { CONTROL_CATALOG } from './control-catalog'
import { NETWORK_BASELINE } from './network-baseline'
import { POLICY_CATALOG } from './policy-catalog'
import { QUESTION_CATALOG } from './question-catalog'
import type { AssessmentCatalog } from './catalog-types'
import { validateAssessmentCatalog } from './validate-catalog'

export const ASSESSMENT_CATALOG = {
  catalog_version: 1,
  controls: CONTROL_CATALOG,
  questions: QUESTION_CATALOG,
  policies: POLICY_CATALOG,
  network_rules: NETWORK_BASELINE,
} as const satisfies AssessmentCatalog

// Catalog errors are deployment errors: fail fast instead of running with ambiguous compliance rules.
validateAssessmentCatalog(ASSESSMENT_CATALOG)

export * from './catalog-types'
export * from './control-catalog'
export * from './network-baseline'
export * from './policy-catalog'
export * from './question-catalog'
export * from './validate-catalog'
