import { listResource } from '@/lib/list-resource'
import type { Organization } from '@/app/types/payload-types'
import { httpClient } from '@/lib/http-client'
import type { OrganizationStatusImpact } from '@/domain/organizations/organization-lifecycle'
import type { OrganizationStatusInput } from './schema'

export function listOrganizations(params?: { asOrganization?: string }) {
  return listResource<Organization>('/api/organizations', {
    depth: '1',
    asOrganization: params?.asOrganization,
  })
}

export function getOrganizationStatusImpact(id: string) {
  return httpClient.get<OrganizationStatusImpact>(
    `/api/v1/platform-admin/organizations/${id}/status-impact`
  )
}

export function setOrganizationStatus(id: string, input: OrganizationStatusInput) {
  return httpClient.post<{ ok: boolean }>(
    `/api/v1/platform-admin/organizations/${id}/status`,
    input
  )
}
