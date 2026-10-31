import type { PayloadRequest } from 'payload'

// Catálogo propio de Siam — NO el catálogo de documentation/02-core-interfaces.md, que lista
// módulos (compliance_documents, compliance_assessments, compliance_tasks) que no existen como
// collections acá. Se amplía cuando exista un módulo real, no antes.
export const FEATURE_CATALOG = [
  'asset_inventory',
  'security_assessments',
  'risk_score',
  'tasks',
] as const

export type FeatureKey = (typeof FEATURE_CATALOG)[number]
export type FeatureToggles = Record<FeatureKey, boolean>

export function defaultFeatures(): FeatureToggles {
  return Object.fromEntries(FEATURE_CATALOG.map(key => [key, true])) as FeatureToggles
}

/**
 * Subscriptions created before a feature existed lack its key: the catalog defaults fill missing
 * keys without overriding an explicit false, so no blocking migration is needed.
 */
export function normalizeFeatures(raw: unknown): FeatureToggles {
  const persisted = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return { ...defaultFeatures(), ...persisted } as FeatureToggles
}

/** The organization's plan features, read the same way by the session and every endpoint. */
export async function organizationFeatures(
  req: PayloadRequest,
  organizationId: string
): Promise<FeatureToggles> {
  const result = await req.payload.find({
    collection: 'subscriptions',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  return normalizeFeatures(result.docs[0]?.features)
}
