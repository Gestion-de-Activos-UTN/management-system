'use client'

import { useQuery } from '@tanstack/react-query'
import { getSecurityReviewSummary } from '../service'

export function useRiskSummary(params?: {
  officeId?: string | null
  asOrganization?: string
  enabled?: boolean
}) {
  return useQuery({
    queryKey: ['assessments', 'risk-summary', params?.asOrganization, params?.officeId],
    refetchInterval: query => ['pending', 'processing', 'outdated'].includes(query.state.data?.recalculation ?? '') ? 3000 : 30000,
    queryFn: () => getSecurityReviewSummary(params),
    enabled: params?.enabled ?? true,
  })
}
