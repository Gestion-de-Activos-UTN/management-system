'use client'

import { useListQuery } from '@/lib/use-list-query'
import { listOfficeAgentSummary, listOffices, revokeAgent } from '../service'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import type { AgentPlatform } from '@/domain/agents/buildAgentPackage'
import { provisionAgent } from '../service'

export function useOfficesList(asOrganization?: string) {
  return useListQuery('offices', () => listOffices({ asOrganization }), [asOrganization])
}

export function useProvisionAgent() {
  const queryClient = useQueryClient()
  return useMutation<Blob, HttpError, { officeId: string; platform: AgentPlatform }>({
    mutationFn: ({ officeId, platform }) => provisionAgent(officeId, platform),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['office-agent-summary'] }),
    onError: error => {
      notifications.show({
        color: 'red',
        message: error.message ?? 'Could not install the scanner',
      })
    },
  })
}

export function useOfficeAgentSummary(asOrganization?: string) {
  return useListQuery('office-agent-summary', () => listOfficeAgentSummary(asOrganization), [
    asOrganization,
  ])
}

export function useRevokeAgent() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, string>({
    mutationFn: revokeAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['office-agent-summary'] })
      notifications.show({ color: 'green', message: 'Scanner access revoked' })
    },
    onError: error => {
      notifications.show({ color: 'red', message: error.message ?? 'Could not revoke the scanner' })
    },
  })
}
