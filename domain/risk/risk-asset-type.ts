import type { ManualAssetCategory, ScannedAssetType } from '@/domain/assets/asset-types'
import type { RiskAssetType } from './catalog-v2/types'

// Plan §3.2: explicit mapping only, never by resemblance. `null` = no risk model applies; the asset
// stays in inventory but is excluded from RIEM and coverage.
const SCANNED: Record<ScannedAssetType, RiskAssetType | null> = {
  workstation: 'workstation',
  mobile: 'mobile',
  server: 'server',
  gateway: 'gateway',
  network_device: 'network_device',
  printer: null,
  iot: null,
  other: null,
}

const MANUAL: Record<ManualAssetCategory, RiskAssetType | null> = {
  computer: 'workstation',
  mobile_device: 'mobile',
  server: 'server',
  // ponytail: manual "Router, switch or access point" maps to network_device, so it does not get
  // A.8.2 (gateway only). Routers are normally discovered by the scanner as `gateway`; split the
  // manual category if manually registered routers become common.
  network_device: 'network_device',
  printer: null,
  iot: null,
  removable_media: null,
  other_equipment: null,
  antivirus_edr: null,
  software_license: 'software_license',
  cloud_asset: 'cloud_asset',
  provider_service: null,
  backup: null,
  information_repository: 'information_repository',
  physical_record: null,
  other: null,
}

// Categories that receive assessment cycles. Narrower than MANUAL on purpose: mobile_device, server
// and network_device are in the risk population but have no manual assessments yet.
// ponytail: second source next to MANUAL; merge both into one Record if categories keep growing.
export const ASSESSABLE_MANUAL = [
  'computer',
  'software_license',
  'cloud_asset',
  'information_repository',
] as const satisfies readonly ManualAssetCategory[]

export const isManualCategoryAssessable = (category: ManualAssetCategory): boolean =>
  (ASSESSABLE_MANUAL as readonly ManualAssetCategory[]).includes(category)

export const riskAssetTypeForScanned = (type: ScannedAssetType): RiskAssetType | null =>
  SCANNED[type]

export const riskAssetTypeForManual = (category: ManualAssetCategory): RiskAssetType | null =>
  MANUAL[category]
