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
    // Espera el refetch: el botón sigue en loading hasta que la fila muestra la fecha nueva.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['non-network-assets'] })
      notifications.show({ color: 'green', message: 'Revisión confirmada' })
    },
    onError: error => showApiError(error, 'No se pudo confirmar la revisión'),
  })
}
