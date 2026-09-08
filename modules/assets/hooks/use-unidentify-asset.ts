'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { unidentifyAsset } from '../service'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

export function useUnidentifyAsset() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { id: string }>({
    mutationFn: ({ id }) => unidentifyAsset(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        invalidateSecurityReview(queryClient),
      ])
      notifications.show({ color: 'green', message: 'Identification removed' })
    },
    onError: error => showApiError(error, 'Could not remove identification'),
  })
}
