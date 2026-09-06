import type { CollectionBeforeChangeHook } from 'payload'

// owner/criticality solo tienen sentido si el activo está 'authorized' — antes esta regla vivía
// solo en el .superRefine() de modules/assets/schema.ts (AssetIdentificationSchema), que únicamente
// corre dentro de endpoints/assetIdentify.ts. Un PATCH genérico (modules/assets/service.ts) que
// cambie authorization_status sin pasar por ese endpoint podía dejar el asset 'unauthorized' con
// owner/criticality todavía asignados. Se aplica acá, a nivel de colección, para cualquier caller.
export const enforceAuthorizationInvariant: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const authorizationStatus = data?.authorization_status ?? originalDoc?.authorization_status
  if (authorizationStatus === 'authorized') return data

  const clearsOwner = 'owner' in (data ?? {}) ? data.owner == null : originalDoc?.owner == null
  const clearsCriticality =
    'criticality' in (data ?? {}) ? data.criticality == null : originalDoc?.criticality == null
  if (clearsOwner && clearsCriticality) return data

  return { ...data, owner: null, criticality: null }
}
