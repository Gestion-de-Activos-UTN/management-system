'use client'

import { useListQuery } from '@/lib/use-list-query'
import { listOfficeAgentSummary, listOffices } from '../service'
import { useMutation } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { provisionAgent } from '../service'

export function useOfficesList(asOrganization?: string) {
  return useListQuery('offices', () => listOffices({ asOrganization }), [asOrganization])
}

export function useProvisionAgent() {
  return useMutation<Blob, HttpError, string>({
    mutationFn: provisionAgent,
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
