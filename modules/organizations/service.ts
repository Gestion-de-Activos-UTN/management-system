import { listResource } from '@/lib/list-resource'
import type { Organization } from '@/app/types/payload-types'
import { httpClient } from '@/lib/http-client'
import type { OrganizationStatusImpact } from '@/domain/organizations/organization-lifecycle'
import type { OrganizationCreateInput, OrganizationStatusInput } from './schema'

export type OrganizationOperationalCounts = {
  counts: {
    offices: Record<string, number>
    agents: Record<string, { active: number; online: number }>
  }
}

export function listOrganizations(params?: { asOrganization?: string }) {
  return listResource<Organization>('/api/organizations', {
    depth: '1',
    asOrganization: params?.asOrganization,
  })
}

export function getOrganizationOperationalSummary() {
  return httpClient.get<OrganizationOperationalCounts>(
    '/api/v1/platform-admin/organizations/operational-summary'
  )
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

export function createOrganization(input: OrganizationCreateInput) {
  return httpClient.post<{ id: string; name: string }>(
    '/api/v1/platform-admin/organizations',
    input
  )
}
