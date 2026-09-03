import { listResource } from '@/lib/list-resource'
import type { Office } from '@/app/types/payload-types'
import { httpClient } from '@/lib/http-client'
import type { OfficeAgentSummary } from '@/endpoints/officeAgentSummary'
import type { AgentPlatform } from '@/domain/agents/buildAgentPackage'

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
  return httpClient
    .get<{ docs: OfficeAgentSummary[] }>('/api/v1/offices/agent-summary', { asOrganization })
    .then(result => result.docs)
}
