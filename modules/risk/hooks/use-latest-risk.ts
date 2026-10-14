'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getLatestRisk } from '../service'

export const useLatestRisk = (params?: {
  evaluationId?: string
  officeId?: string | null
  asOrganization?: string
  page?: number
  enabled?: boolean
}) =>
  useQuery({
    queryKey: [
      'risk',
      'latest',
      params?.asOrganization,
      params?.officeId,
      params?.page ?? 1,
      params?.evaluationId,
    ],
    queryFn: () => getLatestRisk(params),
    enabled: params?.enabled ?? true,
    refetchInterval: query => {
      if (params?.evaluationId) return false
      const state = query.state.data?.recalculation
      return state === 'pending' || state === 'processing' || state === 'outdated' ? 3000 : 30000
    },
    // Keeps the current page visible while the next one loads.
    placeholderData: keepPreviousData,
  })
