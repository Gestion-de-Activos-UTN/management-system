'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { unidentifyAsset } from '../service'

export function useUnidentifyAsset() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { id: string }>({
    mutationFn: ({ id }) => unidentifyAsset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      notifications.show({ color: 'green', message: 'Identification removed' })
    },
    onError: error => {
      notifications.show({
        color: 'red',
        message: error.message ?? 'Could not remove identification',
      })
    },
  })
}
