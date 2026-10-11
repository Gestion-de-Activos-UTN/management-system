'use client'

import { useListQuery } from '@/lib/use-list-query'
import {
  getOfficeDeactivationImpact,
  listOfficeAgentSummary,
  listOffices,
  revokeAgent,
  saveOffice,
  setOfficeActive,
} from '../service'
import type { OfficeInput } from '../schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Office } from '@/app/types/payload-types'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import type { AgentPlatform } from '@/domain/agents/buildAgentPackage'
import { provisionAgent } from '../service'

const activeOnly = (offices: Office[]) => offices.filter(office => office.is_active !== false)

// Una oficina desactivada sigue existiendo (historial), pero no se ofrece para elegir: por
// defecto se filtra. Sólo Administración → Oficinas pide también las inactivas.
export function useOfficesList(
  asOrganization?: string,
  options: { includeInactive?: boolean } = {}
) {
  return useQuery({
    queryKey: ['offices', asOrganization],
    queryFn: () => listOffices({ asOrganization }),
    select: options.includeInactive ? undefined : activeOnly,
  })
}

export function useProvisionAgent() {
  const queryClient = useQueryClient()
  return useMutation<Blob, HttpError, { officeId: string; platform: AgentPlatform }>({
    mutationFn: ({ officeId, platform }) => provisionAgent(officeId, platform),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['office-agent-summary'] }),
    onError: error => showApiError(error, 'No se pudo instalar el escáner'),
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
      notifications.show({ color: 'green', message: 'Acceso del escáner revocado' })
    },
    onError: error => showApiError(error, 'No se pudo revocar el escáner'),
  })
}

// Una oficina nueva o (des)activada cambia el selector de oficinas, el tenant context (oficinas
// de cada persona), los escáneres y la lista de miembros (desactivados en cascada).
function invalidateOfficeScope(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    ['offices', 'office-agent-summary', 'tenant-context', 'org-members'].map(key =>
      queryClient.invalidateQueries({ queryKey: [key] })
    )
  )
}

export function useSaveOffice(asOrganization?: string) {
  const queryClient = useQueryClient()
  return useMutation<Office, HttpError, { input: OfficeInput; id?: string }>({
    mutationFn: ({ input, id }) => saveOffice(input, id, asOrganization),
    onSuccess: (_, { id }) => {
      notifications.show({
        color: 'green',
        message: id ? 'Oficina actualizada.' : 'Oficina creada.',
      })
      return invalidateOfficeScope(queryClient)
    },
  })
}

export function useOfficeDeactivationImpact(officeId: string | null, asOrganization?: string) {
  return useQuery({
    queryKey: ['office-deactivation-impact', officeId, asOrganization],
    queryFn: () => getOfficeDeactivationImpact(officeId!, asOrganization),
    enabled: Boolean(officeId),
    // Siempre fresco: el impacto cambia con cada alta/baja de agentes y personas.
    staleTime: 0,
  })
}

export function useSetOfficeActive(asOrganization?: string) {
  const queryClient = useQueryClient()
  return useMutation<
    unknown,
    HttpError,
    { id: string; isActive: boolean; confirmMemberDeactivation?: boolean }
  >({
    mutationFn: ({ id, isActive, confirmMemberDeactivation = false }) =>
      setOfficeActive(id, isActive, confirmMemberDeactivation, asOrganization),
    onSuccess: (_, { isActive }) => {
      notifications.show({
        color: 'green',
        message: isActive ? 'Oficina reactivada.' : 'Oficina desactivada.',
      })
      return invalidateOfficeScope(queryClient)
    },
    onError: error => showApiError(error, 'No se pudo cambiar el estado de la oficina'),
  })
}
