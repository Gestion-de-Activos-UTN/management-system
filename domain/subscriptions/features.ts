// Catálogo propio de Siam — NO el catálogo de documentation/02-core-interfaces.md, que lista
// módulos (compliance_documents, compliance_assessments, compliance_tasks) que no existen como
// collections acá. Se amplía cuando exista un módulo real, no antes.
export const FEATURE_CATALOG = ['asset_inventory'] as const

export type FeatureKey = (typeof FEATURE_CATALOG)[number]
export type FeatureToggles = Record<FeatureKey, boolean>

export function defaultFeatures(): FeatureToggles {
  return Object.fromEntries(FEATURE_CATALOG.map((key) => [key, true])) as FeatureToggles
}
