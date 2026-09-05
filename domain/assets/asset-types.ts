// Dos catálogos distintos a propósito: un Asset es hardware observado en la red;
// un NonNetworkAsset es un recurso lógico declarado por una persona. Compartir nombres entre
// ambos ocultaría esa diferencia y haría ambiguas las reglas de aplicabilidad de los controles.
export const SCANNED_ASSET_TYPE_VALUES = [
  'workstation',
  'mobile',
  'gateway',
  'network_device',
  'printer',
  'server',
  'iot',
  'other',
] as const

export type ScannedAssetType = (typeof SCANNED_ASSET_TYPE_VALUES)[number]

export const SCANNED_ASSET_TYPE_OPTIONS = [
  { value: 'workstation', label: 'Computer' },
  { value: 'mobile', label: 'Phone or tablet' },
  { value: 'gateway', label: 'Router or gateway' },
  { value: 'network_device', label: 'Switch or access point' },
  { value: 'printer', label: 'Printer or multifunction device' },
  { value: 'server', label: 'Server' },
  { value: 'iot', label: 'IoT or embedded device' },
  { value: 'other', label: 'Other network device' },
] as const

export const MANUAL_ASSET_CATEGORY_VALUES = [
  'computer',
  'mobile_device',
  'server',
  'network_device',
  'printer',
  'iot',
  'removable_media',
  'other_equipment',
  'antivirus_edr',
  'software_license',
  'cloud_asset',
  'provider_service',
  'backup',
  'information_repository',
  'physical_record',
  'other',
] as const

export type ManualAssetCategory = (typeof MANUAL_ASSET_CATEGORY_VALUES)[number]

export const MANUAL_ASSET_CATEGORY_OPTIONS = [
  { value: 'computer', label: 'Computer' },
  { value: 'mobile_device', label: 'Phone or tablet' },
  { value: 'server', label: 'Server' },
  { value: 'network_device', label: 'Router, switch or access point' },
  { value: 'printer', label: 'Printer or multifunction device' },
  { value: 'iot', label: 'IoT or embedded device' },
  { value: 'removable_media', label: 'Removable storage' },
  { value: 'other_equipment', label: 'Other equipment' },
  { value: 'antivirus_edr', label: 'Antivirus / EDR' },
  { value: 'software_license', label: 'Software license' },
  { value: 'cloud_asset', label: 'Cloud service' },
  { value: 'provider_service', label: 'External service' },
  { value: 'backup', label: 'Backup' },
  { value: 'information_repository', label: 'Information repository' },
  { value: 'physical_record', label: 'Physical record' },
  { value: 'other', label: 'Other' },
] as const

export const MANUAL_ASSET_CATEGORY_GROUPS = [
  {
    group: 'Equipment',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(0, 8),
  },
  {
    group: 'Software and services',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(8, 13),
  },
  {
    group: 'Information and physical',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(13),
  },
] as const
