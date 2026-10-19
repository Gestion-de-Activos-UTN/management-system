'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { useListQuery } from '@/lib/use-list-query'
import { getOrganizationStatusImpact, listOrganizations, setOrganizationStatus } from '../service'
import type { OrganizationStatusInput } from '../schema'

export function useOrganizationsList(asOrganization?: string) {
  return useListQuery('organizations', () => listOrganizations({ asOrganization }), [
    asOrganization,
  ])
}

export function useOrganizationStatusImpact(organizationId: string | null) {
  return useQuery({
    queryKey: ['organizations', 'status-impact', organizationId],
    queryFn: () => getOrganizationStatusImpact(organizationId!),
    enabled: Boolean(organizationId),
    // Siempre fresco: el impacto cambia con cada alta o baja dentro de la organización.
    staleTime: 0,
  })
}

export function useSetOrganizationStatus() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { id: string; input: OrganizationStatusInput }>({
    mutationFn: ({ id, input }) => setOrganizationStatus(id, input),
    onSuccess: (_, { input }) => {
      notifications.show({
        color: 'green',
        message: input.is_active ? 'Organización reactivada.' : 'Organización desactivada.',
      })
      return Promise.all(
        ['organizations', 'platform-admin'].map(key =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      )
    },
    onError: error => showApiError(error, 'No se pudo cambiar el estado de la organización'),
  })
}
