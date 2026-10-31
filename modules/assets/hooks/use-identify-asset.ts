'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
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
      notify({ color: 'green', title: 'Activo identificado' })
    },
    onError: error => showApiError(error, 'No se pudo identificar el activo'),
  })
}
