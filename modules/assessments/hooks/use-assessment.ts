'use client'

import { useQuery } from '@tanstack/react-query'
import { getAssessment } from '../service'

export function useAssessment(id: string, asOrganization?: string) {
  return useQuery({
    queryKey: ['assessments', 'detail', id, asOrganization ?? null],
    queryFn: () => getAssessment(id, asOrganization),
    enabled: Boolean(id),
  })
}
