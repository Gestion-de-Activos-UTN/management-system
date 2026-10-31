'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import {
  listAdminPortalMessages,
  listMyPortalMessages,
  listPortalMessageEntityOptions,
  replayPortalMessage,
  savePortalMessage,
  updatePortalMessageReceipt,
} from '../service'
import { showApiError } from '@/lib/notify-error'
import type { PortalMessageInput } from '../schema'

export function useAdminPortalMessages(organizationIds: string[]) {
  return useQuery({
    queryKey: ['platform-admin', 'portal-messages', organizationIds],
    queryFn: () => listAdminPortalMessages(organizationIds),
  })
}

export function usePortalMessageEntityOptions(
  scope: 'global' | 'organizations',
  organizationIds: string[],
  type: string | null
) {
  return useQuery({
    queryKey: ['platform-admin', 'portal-message-entities', scope, organizationIds, type],
    queryFn: () => listPortalMessageEntityOptions(scope, organizationIds, type!),
    enabled: Boolean(type),
  })
}

export function useSavePortalMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, id }: { input: PortalMessageInput; id?: string }) =>
      savePortalMessage(input, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['platform-admin', 'portal-messages'] }),
  })
}

export function useSetPortalMessageActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ input, id }: { input: PortalMessageInput; id: string }) =>
      savePortalMessage(input, id),
    onSuccess: (_, { input }) => {
      notify({
        color: 'green',
        title: input.is_active ? 'Mensaje activado.' : 'Mensaje desactivado.',
      })
      return queryClient.invalidateQueries({ queryKey: ['platform-admin', 'portal-messages'] })
    },
    onError: (error, { input }) =>
      showApiError(
        error,
        input.is_active ? 'No se pudo activar el mensaje.' : 'No se pudo desactivar el mensaje.'
      ),
  })
}

export function useReplayPortalMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: replayPortalMessage,
    onSuccess: () => {
      notify({
        color: 'green',
        title: 'Mensaje listo para volver a mostrarse',
        message: 'Sus destinatarios lo verán nuevamente.',
      })
      return queryClient.invalidateQueries({ queryKey: ['platform-admin', 'portal-messages'] })
    },
    onError: error => showApiError(error, 'No se pudo volver a mostrar el mensaje.'),
  })
}

export function usePortalMessages(enabled = true) {
  return useQuery({
    queryKey: ['portal-messages', 'mine'],
    queryFn: listMyPortalMessages,
    enabled,
    refetchInterval: 60_000,
  })
}

export function usePortalMessageReceipt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      deliveryVersion,
    }: {
      id: string
      status: 'seen' | 'dismissed'
      deliveryVersion: number
    }) => updatePortalMessageReceipt(id, status, deliveryVersion),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-messages', 'mine'] }),
  })
}
