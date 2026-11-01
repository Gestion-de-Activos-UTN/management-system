/**
 * Dónde se ve un activo en el portal. El detectado por el escáner tiene su detalle; uno manual no
 * tiene página propia, así que se abre la pestaña de activos manuales filtrada por él (ver
 * `?nonNetworkAsset=` en app/portal/(protected)/inventory/page.tsx). Pasar por `portalHref`.
 */
export function inventoryAssetPath(kind: 'scanned' | 'manual', id: string): string {
  return kind === 'scanned'
    ? `/portal/inventory/${encodeURIComponent(id)}`
    : `/portal/inventory?nonNetworkAsset=${encodeURIComponent(id)}`
}

/** Misma ruta a partir de la clave de riesgo (`asset:<id>` o `manual:<id>`, domain/risk/build-pairs.ts). */
export function riskAssetPath(assetKey: string): string | null {
  const [prefix, id] = assetKey.split(':', 2)
  if (!id) return null
  if (prefix === 'asset') return inventoryAssetPath('scanned', id)
  if (prefix === 'manual') return inventoryAssetPath('manual', id)
  return null
}
