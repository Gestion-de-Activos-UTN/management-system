'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { useListQuery } from '@/lib/use-list-query'
import {
  getOrganizationOperationalSummary,
  getOrganizationStatusImpact,
  createOrganization,
  listOrganizations,
  setOrganizationStatus,
  updateOrganizationDetails,
  getOrganizationDetails,
} from '../service'
import type {
  OrganizationCreateInput,
  OrganizationDetailsInput,
  OrganizationStatusInput,
} from '../schema'

export function useUpdateOrganizationDetails() {
  const client = useQueryClient()
  return useMutation<unknown, HttpError, { id: string; input: OrganizationDetailsInput }>({
    mutationFn: ({ id, input }) => updateOrganizationDetails(id, input),
    onSuccess: async () => {
      await Promise.all(
        ['organizations', 'platform-admin', 'organization-settings'].map(key =>
          client.invalidateQueries({ queryKey: [key] })
        )
      )
      notify({ color: 'green', title: 'Organización actualizada.' })
    },
    onError: error => showApiError(error, 'No se pudo actualizar la organización'),
  })
}

export function useOrganizationDetails(id: string | null) {
  return useQuery({
    queryKey: ['organizations', 'details', id],
    queryFn: () => getOrganizationDetails(id!),
    enabled: Boolean(id),
  })
}

export function useOrganizationsList(asOrganization?: string) {
  return useListQuery('organizations', () => listOrganizations({ asOrganization }), [
    asOrganization,
  ])
}

export function useOrganizationOperationalSummary() {
  return useQuery({
    queryKey: ['platform-admin', 'organizations', 'operational-summary'],
    queryFn: getOrganizationOperationalSummary,
    refetchInterval: 60_000,
  })
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
      notify({
        color: 'green',
        title: input.is_active ? 'Organización reactivada.' : 'Organización desactivada.',
      })
      return Promise.all(
        ['organizations', 'platform-admin'].map(key =>
          queryClient.invalidateQueries({ queryKey: [key] })
        )
      )
    },
    onError: (error, { input }) =>
      showApiError(
        error,
        input.is_active
          ? 'No se pudo reactivar la organización'
          : 'No se pudo desactivar la organización'
      ),
  })
}

export function useCreateOrganization() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, OrganizationCreateInput>({
    mutationFn: createOrganization,
    onSuccess: () => {
      notify({ color: 'green', title: 'Organización creada.' })
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organizations'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-admin'] }),
      ])
    },
    onError: error => {
      if (error.code !== 'email_unavailable')
        showApiError(error, 'No se pudo crear la organización')
    },
  })
}
