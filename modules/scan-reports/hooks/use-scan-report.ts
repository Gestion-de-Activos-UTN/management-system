'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { showApiError } from '@/lib/notify-error'
import { getScanReport, renameScanReport } from '../service'

export function useScanReport(id: string) {
  return useQuery({
    queryKey: ['scan-reports', id],
    queryFn: () => getScanReport(id),
    enabled: !!id,
  })
}

export function useRenameScanReport(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (displayName: string) => renameScanReport(id, { display_name: displayName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scan-reports'] })
      notify({ color: 'green', title: 'Nombre del escaneo guardado' })
    },
    onError: error => showApiError(error, 'No se pudo guardar el nombre del escaneo'),
  })
}
