'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { showApiError } from '@/lib/notify-error'
import { getSnapshot, renameSnapshot } from '../service'

export function useSnapshot(id: string) {
  return useQuery({
    queryKey: ['inventory-snapshots', id],
    queryFn: () => getSnapshot(id),
    enabled: !!id,
  })
}

export function useRenameSnapshot(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (displayName: string) => renameSnapshot(id, { display_name: displayName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-snapshots'] })
      notify({ color: 'green', title: 'Nombre de la instantánea guardado' })
    },
    onError: error => showApiError(error, 'No se pudo guardar el nombre de la instantánea'),
  })
}
