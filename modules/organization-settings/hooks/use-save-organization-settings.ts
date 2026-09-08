'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { updateOrganizationSettings, type OrganizationSettingsFormValues } from '../service'

export function useSaveOrganizationSettings() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, OrganizationSettingsFormValues>({
    mutationFn: values => updateOrganizationSettings(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] })
      notifications.show({ color: 'green', message: 'Settings saved' })
    },
    onError: error => showApiError(error, 'Could not save settings'),
  })
}
