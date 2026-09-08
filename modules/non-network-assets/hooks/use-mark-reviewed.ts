'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { markReviewed } from '../service'

export function useMarkReviewed() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, string>({
    mutationFn: id => markReviewed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['non-network-assets'] })
      notifications.show({ color: 'green', message: 'Review confirmed' })
    },
    onError: error => showApiError(error, 'Could not confirm the review'),
  })
}
