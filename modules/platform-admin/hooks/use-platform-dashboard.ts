import { useQuery } from '@tanstack/react-query'
import { getPlatformDashboardMetrics } from '../service'

export function usePlatformDashboard() {
  return useQuery({
    queryKey: ['platform-admin', 'dashboard'],
    queryFn: getPlatformDashboardMetrics,
    refetchInterval: 60_000,
  })
}
