// ponytail: heurística placeholder (% de superficie crítica offline, ponderado por criticality),
// no es el algoritmo real de risk score — fuera de alcance de documentation/05-inventory-architecture.md
// y de RF-30 (doc aparte, todavía no escrito). Reemplazar esta función cuando exista esa
// especificación; la firma (assets) => number ya es estable, nada más depende de la heurística interna.
const CRITICALITY_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 5 }

interface RiskScoreAsset {
  criticality?: string | null
  status?: string | null
}

// 0 = sin riesgo detectado (o sin activos), 100 = toda la superficie ponderada por criticidad
// está offline. Un Asset 'retired' no aporta riesgo de disponibilidad (ya no se espera que
// responda) ni tampoco reduce el score — simplemente no entra en el cálculo.
export function computeRiskScore(assets: RiskScoreAsset[]): number {
  let totalWeight = 0
  let offlineWeight = 0

  for (const asset of assets) {
    if (asset.status === 'retired') continue
    const weight = CRITICALITY_WEIGHT[asset.criticality ?? ''] ?? 1
    totalWeight += weight
    if (asset.status === 'offline') offlineWeight += weight
  }

  if (totalWeight === 0) return 0
  return Math.round((offlineWeight / totalWeight) * 100)
}
