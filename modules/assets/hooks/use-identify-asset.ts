'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { identifyAsset } from '../service'
import type { AssetIdentification } from '../schema'

export function useIdentifyAsset() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { id: string; identification: AssetIdentification }>({
    mutationFn: ({ id, identification }) => identifyAsset(id, identification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      notifications.show({ color: 'green', message: 'Asset identified' })
    },
    onError: error => {
      notifications.show({
        color: 'red',
        message: error.message ?? 'Could not update identification status',
      })
    },
  })
}
