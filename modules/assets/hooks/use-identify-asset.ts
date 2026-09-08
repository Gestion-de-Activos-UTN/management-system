'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { identifyAsset } from '../service'
import type { AssetIdentification } from '../schema'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

export function useIdentifyAsset() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { id: string; identification: AssetIdentification }>({
    mutationFn: ({ id, identification }) => identifyAsset(id, identification),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        invalidateSecurityReview(queryClient),
      ])
      notifications.show({ color: 'green', message: 'Asset identified' })
    },
    onError: error => showApiError(error, 'Could not update identification status'),
  })
}
