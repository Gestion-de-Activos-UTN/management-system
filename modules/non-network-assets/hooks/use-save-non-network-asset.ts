'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { createNonNetworkAsset, updateNonNetworkAsset } from '../service'
import type { NonNetworkAssetFormValues } from '../schema'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

// Create y update comparten un solo hook: la única diferencia real es qué función de service
// llamar y el mensaje de éxito — separar en dos hooks solo duplicaría la invalidación/notificación.
export function useSaveNonNetworkAsset(id?: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, NonNetworkAssetFormValues>({
    mutationFn: values => (id ? updateNonNetworkAsset(id, values) : createNonNetworkAsset(values)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['non-network-assets'] }),
        invalidateSecurityReview(queryClient),
      ])
      notifications.show({ color: 'green', message: id ? 'Asset updated' : 'Asset created' })
    },
    onError: error => showApiError(error, 'Could not save the asset'),
  })
}
