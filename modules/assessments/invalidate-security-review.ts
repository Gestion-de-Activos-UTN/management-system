import type { QueryClient } from '@tanstack/react-query'

/**
 * Assessment mutations happen as a side effect of asset changes. Refresh every cached
 * Security Review variant, including inactive office filters and the risk summary, so the
 * next navigation never reuses a list captured before the asset was reconciled.
 */
export function invalidateSecurityReview(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['assessments'], refetchType: 'all' }),
    queryClient.invalidateQueries({ queryKey: ['risk'], refetchType: 'all' }),
    queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'all' }),
  ])
}
