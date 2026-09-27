'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { generateSnapshot } from '../service'

// Invalida solo ['inventory-snapshots'] — nunca ['assets']/['non-network-assets']: generar un
// snapshot es una LECTURA de esas colecciones en un instante, no las modifica.
export function useGenerateSnapshot() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, string>({
    mutationFn: officeId => generateSnapshot(officeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-snapshots'] })
      notifications.show({ color: 'green', message: 'Instantánea generada' })
    },
    onError: error => showApiError(error, 'No se pudo generar la instantánea'),
  })
}
