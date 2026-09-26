'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getLatestRisk } from '../service'

export const useLatestRisk = (params?: {
  officeId?: string | null
  asOrganization?: string
  page?: number
}) =>
  useQuery({
    queryKey: ['risk', 'latest', params?.asOrganization, params?.officeId, params?.page ?? 1],
    queryFn: () => getLatestRisk(params),
    // Keeps the current page visible while the next one loads.
    placeholderData: keepPreviousData,
  })
