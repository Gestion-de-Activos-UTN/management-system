'use client'

import { useQuery } from '@tanstack/react-query'
import { listAssessments } from '../service'

export function useAssessments(params?: {
  scope?: string
  officeId?: string | null
  assetId?: string
  asOrganization?: string
}) {
  return useQuery({
    queryKey: [
      'assessments',
      params?.scope ?? 'all',
      params?.officeId ?? null,
      params?.assetId ?? null,
      params?.asOrganization ?? null,
    ],
    queryFn: () => listAssessments(params),
  })
}
