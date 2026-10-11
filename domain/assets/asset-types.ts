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
  { value: 'workstation', label: 'Computadora' },
  { value: 'mobile', label: 'Teléfono o tablet' },
  { value: 'gateway', label: 'Router o gateway' },
  { value: 'network_device', label: 'Switch o punto de acceso' },
  { value: 'printer', label: 'Impresora o multifunción' },
  { value: 'server', label: 'Servidor' },
  { value: 'iot', label: 'Dispositivo IoT o embebido' },
  { value: 'other', label: 'Otro dispositivo de red' },
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
  { value: 'computer', label: 'Computadora' },
  { value: 'mobile_device', label: 'Teléfono o tablet' },
  { value: 'server', label: 'Servidor' },
  { value: 'network_device', label: 'Router, switch o punto de acceso' },
  { value: 'printer', label: 'Impresora o multifunción' },
  { value: 'iot', label: 'Dispositivo IoT o embebido' },
  { value: 'removable_media', label: 'Almacenamiento extraíble' },
  { value: 'other_equipment', label: 'Otro equipo' },
  { value: 'antivirus_edr', label: 'Antivirus / EDR' },
  { value: 'software_license', label: 'Licencia de software' },
  { value: 'cloud_asset', label: 'Servicio en la nube' },
  { value: 'provider_service', label: 'Servicio externo' },
  { value: 'backup', label: 'Copia de seguridad' },
  { value: 'information_repository', label: 'Repositorio de información' },
  { value: 'physical_record', label: 'Registro físico' },
  { value: 'other', label: 'Otro' },
] as const

export const MANUAL_ASSET_CATEGORY_GROUPS = [
  {
    group: 'Equipos',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(0, 8),
  },
  {
    group: 'Software y servicios',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(8, 13),
  },
  {
    group: 'Información y registros físicos',
    items: MANUAL_ASSET_CATEGORY_OPTIONS.slice(13),
  },
] as const
