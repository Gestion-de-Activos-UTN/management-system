'use client'

import { useQuery } from '@tanstack/react-query'
import { useUiStore } from '@/lib/ui-store'
import { getDashboardMetrics } from '../service'

export function useDashboardMetrics(asOrganization?: string) {
  const selectedOfficeId = useUiStore(state => state.selectedOfficeId)
  return useQuery({
    queryKey: ['dashboard-metrics', asOrganization, selectedOfficeId],
    queryFn: () => getDashboardMetrics({ asOrganization, officeId: selectedOfficeId }),
  })
}
