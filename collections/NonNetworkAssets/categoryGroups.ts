import type { ManualAssetCategory } from '@/domain/assets/asset-types'

export type CategoryGroup = 'product_details' | 'cloud_details' | 'repository_details'

// Record exhaustivo: una categoría nueva en el enum no compila acá hasta que se decida su grupo.
// Es una decisión distinta de CATEGORY_HAS_SOFTWARE (capacidad vs. qué campos se muestran).
export const CATEGORY_GROUP: Record<ManualAssetCategory, CategoryGroup | null> = {
  computer: null,
  mobile_device: null,
  server: null,
  network_device: null,
  printer: null,
  iot: null,
  removable_media: null,
  other_equipment: null,
  antivirus_edr: 'product_details',
  software_license: 'product_details',
  cloud_asset: 'cloud_details',
  provider_service: null,
  backup: null,
  information_repository: 'repository_details',
  physical_record: null,
  other: null,
}

export function categoryGroupOf(category: string | null | undefined): CategoryGroup | null {
  if (!category || !Object.prototype.hasOwnProperty.call(CATEGORY_GROUP, category)) return null
  return CATEGORY_GROUP[category as ManualAssetCategory]
}

export const CLOUD_KIND_OPTIONS = [
  { value: 'productivity_identity', label: 'Productivity and identity' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'domain_dns', label: 'Domain and DNS' },
] as const

export const REPOSITORY_KIND_OPTIONS = [
  { value: 'source_code', label: 'Source code' },
  { value: 'secrets_vault', label: 'Secrets vault' },
  { value: 'corporate_email', label: 'Corporate email' },
  { value: 'database', label: 'Database' },
  { value: 'other_digital', label: 'Other digital' },
] as const