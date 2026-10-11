import { RISK_CATALOG_V2 } from './catalog'
import { validateRiskCatalogV2 } from './validate-catalog'

// Catalog errors are deployment errors. Fail fast instead of calculating with ambiguous rules.
validateRiskCatalogV2(RISK_CATALOG_V2)

export * from './catalog'
export * from './types'
export * from './validate-catalog'
