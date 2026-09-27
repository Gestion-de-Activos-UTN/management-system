import { httpClient } from '@/lib/http-client'
import type { OrganizationSetting } from '@/app/types/payload-types'
import type { OrganizationMaturityValues } from './schema'

export type OrganizationSettingsFormValues = {
  offline_after_hours: number | null
  snapshot_before_each_scan: boolean
  snapshot_interval_days: number | null
}

export function getOrganizationSettings() {
  return httpClient.get<OrganizationSetting>('/api/v1/organization-settings')
}

export function updateOrganizationSettings(values: OrganizationSettingsFormValues) {
  return httpClient.patch<OrganizationSetting>('/api/v1/organization-settings', values)
}

export function updateOrganizationMaturity(values: OrganizationMaturityValues) {
  return httpClient.patch<OrganizationSetting>('/api/v1/organization-settings/maturity', values)
}
