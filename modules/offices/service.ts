import { listResource } from '@/lib/list-resource'
import type { Office } from '@/app/types/payload-types'
import { httpClient } from '@/lib/http-client'
import type { AgentQuotaSummary, OfficeAgentSummary } from '@/endpoints/officeAgentSummary'
import type { AgentPlatform } from '@/domain/agents/buildAgentPackage'
import type { OfficeDeactivationImpact } from '@/domain/offices/office-lifecycle'
import type { OfficeInput } from './schema'

export function listOffices(params?: { asOrganization?: string }) {
  return listResource<Office>('/api/offices', {
    depth: '1',
    asOrganization: params?.asOrganization,
  })
}

export function provisionAgent(officeId: string, platform: AgentPlatform) {
  return httpClient.download('/api/v1/agents/provision', { office_id: officeId, platform })
}

export function listOfficeAgentSummary(asOrganization?: string) {
  return httpClient.get<{ docs: OfficeAgentSummary[]; quota: AgentQuotaSummary | null }>(
    '/api/v1/offices/agent-summary',
    { asOrganization }
  )
}

export function revokeAgent(agentId: string) {
  return httpClient.post(`/api/v1/agents/${agentId}/revoke`, {})
}

export function saveOffice(input: OfficeInput, id?: string, asOrganization?: string) {
  return id
    ? httpClient.patch<Office>(`/api/v1/offices/${id}`, input, { asOrganization })
    : httpClient.post<Office>('/api/v1/offices', input, { asOrganization })
}

export function getOfficeDeactivationImpact(id: string, asOrganization?: string) {
  return httpClient.get<OfficeDeactivationImpact>(`/api/v1/offices/${id}/deactivation-impact`, {
    asOrganization,
  })
}

export function setOfficeActive(
  id: string,
  isActive: boolean,
  confirmMemberDeactivation: boolean,
  asOrganization?: string
) {
  return httpClient.post<{ ok: boolean }>(
    `/api/v1/offices/${id}/status`,
    { is_active: isActive, confirm_member_deactivation: confirmMemberDeactivation },
    { asOrganization }
  )
}
