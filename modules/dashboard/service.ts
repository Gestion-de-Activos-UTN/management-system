import { httpClient } from '@/lib/http-client'
import type { DashboardMetrics } from '@/endpoints/dashboardMetrics'

export function getDashboardMetrics(params?: {
  asOrganization?: string
  officeId?: string | null
}) {
  return httpClient.get<DashboardMetrics>('/api/v1/dashboard/metrics', {
    asOrganization: params?.asOrganization,
    office_id: params?.officeId ?? undefined,
  })
}
