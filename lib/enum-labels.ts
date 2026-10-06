import { MANUAL_ASSET_CATEGORY_OPTIONS } from '@/domain/assets/asset-types'

// Los valores persistidos en el backend ya están en inglés (mismo contrato que
// documentation/05-inventory-architecture.md, traducido en su totalidad — ver
// collections/Assets, collections/NonNetworkAssets). Estos mapas value->label existen igual
// para no hardcodear la lista de opciones de cada <Select> en cuatro lugares distintos
// (SYSTEM_PROMPT.md #3, DRY), y para poder mostrar un label con mayúscula/formato propio
// (ej. "Antivirus / EDR") sin acoplar la UI al valor crudo del enum.
export const CRITICALITY_LABEL: Record<string, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}

export const CRITICALITY_OPTIONS = Object.entries(CRITICALITY_LABEL).map(([value, label]) => ({
  value,
  label,
}))

export const ASSET_STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  retired: 'Retirado',
  offline: 'Sin conexión',
}

export const ASSET_STATUS_OPTIONS = Object.entries(ASSET_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}))

// NonNetworkAssets no admite 'offline' (solo active/retired, ver collections/NonNetworkAssets).
export const NON_NETWORK_ASSET_STATUS_OPTIONS = ASSET_STATUS_OPTIONS.filter(
  o => o.value !== 'offline'
)

// 'offline' es autoridad exclusiva de ingesta/aging (RF-37, rejectManualOfflineStatus.ts) — un
// humano solo puede transicionar entre 'active' y 'retired'.
export const MANUAL_ASSET_STATUS_OPTIONS = ASSET_STATUS_OPTIONS.filter(o => o.value !== 'offline')

export const ASSET_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  MANUAL_ASSET_CATEGORY_OPTIONS.map(option => [option.value, option.label])
)

export const ASSET_CATEGORY_OPTIONS = Object.entries(ASSET_CATEGORY_LABEL).map(
  ([value, label]) => ({
    value,
    label,
  })
)

export const REVIEW_INTERVAL_LABEL: Record<string, string> = {
  never: 'Nunca vence',
  '1d': 'Todos los días',
  '3d': 'Cada 3 días',
  '1w': 'Todas las semanas',
  '1m': 'Todos los meses',
  '6m': 'Cada 6 meses',
  '1y': 'Todos los años',
}

export const REVIEW_INTERVAL_OPTIONS = Object.entries(REVIEW_INTERVAL_LABEL).map(
  ([value, label]) => ({
    value,
    label,
  })
)

export const ASSESSMENT_EXCLUSION_REASON_OPTIONS = [
  { value: 'personal_device', label: 'Dispositivo personal' },
  { value: 'visitor_device', label: 'Dispositivo de visitante' },
  { value: 'third_party_managed', label: 'Administrado por un tercero' },
  { value: 'temporary_or_lab', label: 'Activo temporal o de laboratorio' },
  { value: 'duplicate_or_misidentified', label: 'Duplicado o identificado incorrectamente' },
  { value: 'contractually_out_of_scope', label: 'Fuera de alcance por contrato' },
  { value: 'other', label: 'Otro' },
] as const

export const RISK_BAND_LABEL: Record<string, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
}

export const RISK_CONFIDENCE_LABEL: Record<string, string> = {
  hidden: 'Datos insuficientes',
  preliminary: 'Preliminar',
  warning: 'Parcial',
  usable: 'Utilizable',
  reliable: 'Confiable',
}

export const RISK_PAIR_STATUS_LABEL: Record<string, string> = {
  compliant: 'Cumple',
  partially_effective: 'Cumple parcialmente',
  non_compliant: 'No cumple',
  not_evaluable: 'No evaluable',
}
