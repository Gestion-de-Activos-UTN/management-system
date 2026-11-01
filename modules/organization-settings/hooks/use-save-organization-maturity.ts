'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { updateOrganizationMaturity } from '../service'
import type { OrganizationMaturityValues } from '../schema'

export function useSaveOrganizationMaturity() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, OrganizationMaturityValues>({
    mutationFn: values => updateOrganizationMaturity(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] })
      notify({ color: 'green', title: 'Perfil de la organización guardado' })
    },
    onError: error => showApiError(error, 'No se pudo guardar el perfil de la organización'),
  })
}
