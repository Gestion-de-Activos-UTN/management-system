'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { updateOrganizationSettings, type OrganizationSettingsFormValues } from '../service'

export function useSaveOrganizationSettings() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, OrganizationSettingsFormValues>({
    mutationFn: values => updateOrganizationSettings(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] })
      notify({ color: 'green', title: 'Configuración guardada' })
    },
    onError: error => showApiError(error, 'No se pudo guardar la configuración'),
  })
}
