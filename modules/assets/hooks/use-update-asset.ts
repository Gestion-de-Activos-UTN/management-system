'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { updateAsset } from '../service'
import type { AssetBusinessFields } from '../schema'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

// Invalida el prefijo ['assets'] entero (todas las variantes de filtro/office ya cacheadas),
// nunca ['inventory-snapshots'] — un snapshot ya tomado es una copia por valor de un momento
// pasado, editar el Asset hoy no debe hacerlo parecer distinto retroactivamente.
export function useUpdateAsset(id: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, Partial<AssetBusinessFields>>({
    mutationFn: data => updateAsset(id, data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        invalidateSecurityReview(queryClient),
      ])
      notifications.show({ color: 'green', message: 'Asset updated' })
    },
    onError: error => showApiError(error, 'Could not update the asset'),
  })
}
