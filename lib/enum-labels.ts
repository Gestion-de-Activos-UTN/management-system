// Los valores persistidos en el backend ya están en inglés (mismo contrato que
// documentation/05-inventory-architecture.md, traducido en su totalidad — ver
// collections/Assets, collections/NonNetworkAssets). Estos mapas value->label existen igual
// para no hardcodear la lista de opciones de cada <Select> en cuatro lugares distintos
// (SYSTEM_PROMPT.md #3, DRY), y para poder mostrar un label con mayúscula/formato propio
// (ej. "Antivirus / EDR") sin acoplar la UI al valor crudo del enum.
export const CRITICALITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const CRITICALITY_OPTIONS = Object.entries(CRITICALITY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const ASSET_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  retired: 'Retired',
  offline: 'Offline',
};

export const ASSET_STATUS_OPTIONS = Object.entries(ASSET_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

// NonNetworkAssets no admite 'offline' (solo active/retired, ver collections/NonNetworkAssets).
export const NON_NETWORK_ASSET_STATUS_OPTIONS = ASSET_STATUS_OPTIONS.filter((o) => o.value !== 'offline');

// 'offline' es autoridad exclusiva de ingesta/aging (RF-37, rejectManualOfflineStatus.ts) — un
// humano solo puede transicionar entre 'active' y 'retired'.
export const MANUAL_ASSET_STATUS_OPTIONS = ASSET_STATUS_OPTIONS.filter((o) => o.value !== 'offline');

export const ASSET_CATEGORY_LABEL: Record<string, string> = {
  antivirus_edr: 'Antivirus / EDR',
  software_license: 'Software license',
  cloud_asset: 'Cloud asset',
  backup: 'Backup',
  other: 'Other',
};

export const ASSET_CATEGORY_OPTIONS = Object.entries(ASSET_CATEGORY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const REVIEW_INTERVAL_LABEL: Record<string, string> = {
  never: 'Never expires',
  '1d': 'Every day',
  '3d': 'Every 3 days',
  '1w': 'Every week',
  '1m': 'Every month',
  '6m': 'Every 6 months',
  '1y': 'Every year',
};

export const REVIEW_INTERVAL_OPTIONS = Object.entries(REVIEW_INTERVAL_LABEL).map(([value, label]) => ({
  value,
  label,
}));
