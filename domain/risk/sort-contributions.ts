import type { RiskSortKey } from './constants'

type SortableContribution = {
  id: string | number
  asset_key: string
  control_key: string
  status: 'compliant' | 'partially_effective' | 'non_compliant' | 'not_evaluable'
  excluded: boolean
}

// Orden de lectura del resultado: de mejor a peor y, al final, lo que no se pudo evaluar o
// quedó fuera de la revisión (la UI muestra "Excluido" en lugar del estado).
const STATUS_RANK = { compliant: 0, partially_effective: 1, non_compliant: 2, not_evaluable: 3 }
const EXCLUDED_RANK = 4

const text = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/**
 * Ordena todas las comprobaciones de una evaluación antes de paginar. Cada orden termina en un
 * desempate fijo (activo/control y por último id) para que ninguna fila se repita ni se pierda
 * entre páginas. `label` resuelve el nombre visible del activo (alias, hostname, IP…).
 */
export function sortContributions<T extends SortableContribution>(
  rows: readonly T[],
  label: (assetKey: string) => string,
  sort: RiskSortKey,
  direction: 'asc' | 'desc'
): T[] {
  const byAsset = (a: T, b: T) => text.compare(label(a.asset_key), label(b.asset_key))
  const byControl = (a: T, b: T) => text.compare(a.control_key, b.control_key)
  const byStatus = (a: T, b: T) =>
    (a.excluded ? EXCLUDED_RANK : STATUS_RANK[a.status]) -
    (b.excluded ? EXCLUDED_RANK : STATUS_RANK[b.status])
  const byId = (a: T, b: T) => text.compare(String(a.id), String(b.id))
  const primary = { asset: byAsset, control: byControl, status: byStatus }[sort]
  const tieBreak =
    sort === 'asset' ? [byControl] : sort === 'control' ? [byAsset] : [byControl, byAsset]
  const sign = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const first = primary(a, b) * sign
    if (first) return first
    for (const compare of tieBreak) {
      const result = compare(a, b)
      if (result) return result
    }
    return byId(a, b)
  })
}
