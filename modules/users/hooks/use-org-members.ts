'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import {
  getMemberDeactivationImpact,
  getMyProfile,
  listOrgMembers,
  createOrgMember,
  createPlatformOrgAdmin,
  updateMyProfile,
  updateOrgMember,
  type OrgMember,
} from '../service'
import type { MemberCreate, MemberUpdate, UserCredentials } from '../schema'

export function useOrgMembers(
  asOrganization?: string,
  options: { includeInactive?: boolean } = {}
) {
  const includeInactive = Boolean(options.includeInactive)
  return useQuery<OrgMember[]>({
    queryKey: ['org-members', asOrganization, { includeInactive }],
    queryFn: () => listOrgMembers({ asOrganization, includeInactive }),
  })
}

export function useUpdateOrgMember(asOrganization?: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, { userId: string; input: MemberUpdate; message: string }>({
    mutationFn: ({ userId, input }) => updateOrgMember(userId, input, asOrganization),
    onSuccess: (_, { message }) => {
      notifications.show({ color: 'green', message })
      // Cambiar el propio rol u oficinas cambia también lo que ve quien hizo el cambio; desactivar
      // o quitar oficinas libera responsables de activos y tareas en curso.
      return Promise.all(
        [
          'org-members',
          'tenant-context',
          'my-profile',
          'assets',
          'non-network-assets',
          'tasks',
          'assessments',
        ].map(key => queryClient.invalidateQueries({ queryKey: [key] }))
      )
    },
    onError: (error, { input }) => {
      const action =
        input.is_active === true
          ? 'No se pudo reactivar a la persona'
          : input.is_active === false
            ? 'No se pudo desactivar a la persona'
            : 'No se pudo actualizar a la persona'
      showApiError(error, action, error.code === 'user_limit_reached' ? action : undefined)
    },
  })
}

export function useCreateOrgMember(asOrganization?: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, MemberCreate>({
    mutationFn: input => createOrgMember(input, asOrganization),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Persona creada.' })
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-members'] }),
        queryClient.invalidateQueries({ queryKey: ['tenant-context'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-admin'] }),
      ])
    },
    onError: error => showApiError(error, 'No se pudo crear la persona'),
  })
}

export function useCreatePlatformOrgAdmin(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, UserCredentials>({
    mutationFn: input => createPlatformOrgAdmin(organizationId, input),
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'OrgAdmin añadido.' })
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organizations'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-admin'] }),
      ])
    },
    onError: error => showApiError(error, 'No se pudo añadir el OrgAdmin'),
  })
}

export function useMemberDeactivationImpact(userId: string | null, asOrganization?: string) {
  return useQuery({
    queryKey: ['org-members', 'deactivation-impact', userId, asOrganization],
    queryFn: () => getMemberDeactivationImpact(userId!, asOrganization),
    enabled: Boolean(userId),
    // Siempre fresco: activos y tareas cambian sin pasar por esta pantalla.
    staleTime: 0,
  })
}

export function useMyProfile(enabled = true) {
  return useQuery({ queryKey: ['my-profile'], queryFn: getMyProfile, enabled })
}

export function useUpdateMyProfile() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, string>({
    mutationFn: updateMyProfile,
    onSuccess: () => {
      notifications.show({ color: 'green', message: 'Perfil actualizado.' })
      return queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    },
    onError: error => showApiError(error, 'No se pudo guardar el perfil'),
  })
}
