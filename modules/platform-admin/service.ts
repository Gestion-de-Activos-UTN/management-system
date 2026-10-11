import { httpClient } from '@/lib/http-client'

export type PlatformDashboardMetrics = {
  organizations: { total: number; active: number }
  active_offices: number
  agents: { active: number; online: number }
  pending_incidents: number
}

export function getPlatformDashboardMetrics() {
  return httpClient.get<PlatformDashboardMetrics>('/api/v1/platform-admin/dashboard')
}
