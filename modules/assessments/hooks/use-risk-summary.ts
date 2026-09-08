'use client'

import { useQuery } from '@tanstack/react-query'
import { getSecurityReviewSummary } from '../service'

export function useRiskSummary(params?: { officeId?: string | null; asOrganization?: string }) {
  return useQuery({
    queryKey: ['assessments', 'risk-summary', params?.asOrganization, params?.officeId],
    queryFn: () => getSecurityReviewSummary(params),
  })
}
