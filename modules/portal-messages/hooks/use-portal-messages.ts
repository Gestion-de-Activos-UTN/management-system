'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import {
  listAdminPortalMessages,
  listMyPortalMessages,
  listPortalMessageEntityOptions,
  replayPortalMessage,
  savePortalMessage,
  updatePortalMessageReceipt,
} from '../service'
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

export function useReplayPortalMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: replayPortalMessage,
    onSuccess: () => {
      notifications.show({
        color: 'green',
        message: 'El mensaje volverá a mostrarse a todos sus destinatarios.',
      })
      return queryClient.invalidateQueries({ queryKey: ['platform-admin', 'portal-messages'] })
    },
    onError: () => {
      notifications.show({ color: 'red', message: 'No se pudo volver a mostrar el mensaje.' })
    },
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
