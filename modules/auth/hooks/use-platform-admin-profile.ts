'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import { useSession } from '@/lib/use-session'
import {
  getPlatformAdminProfile,
  updatePlatformAdminProfile,
  type PlatformAdminProfile,
} from '../service'
import type { PlatformAdminProfileInput } from '../schema'

export function usePlatformAdminProfile() {
  const session = useSession()
  return useQuery({
    queryKey: ['platform-admin-profile'],
    queryFn: getPlatformAdminProfile,
    enabled: session?.collection === 'admins',
  })
}

export function useUpdatePlatformAdminProfile() {
  const queryClient = useQueryClient()
  return useMutation<PlatformAdminProfile, HttpError, PlatformAdminProfileInput>({
    mutationFn: updatePlatformAdminProfile,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['platform-admin-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ])
      notify({ color: 'green', title: 'Nombre actualizado' })
    },
    onError: error => showApiError(error, 'No se pudo actualizar el nombre'),
  })
}
