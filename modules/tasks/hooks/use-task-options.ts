'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { TaskReferenceInput } from '../schema'
import { getTaskAssignmentOptions, listTaskReferenceOptions } from '../service'

/**
 * Opciones de entidad relacionada, buscadas en el servidor. Con `selectedId` trae sólo esa
 * entidad (aunque ya no se ofrezca), para mostrar lo elegido o fijado.
 */
export function useTaskReferenceOptions(
  type: TaskReferenceInput['relationTo'] | null,
  {
    asOrganization,
    search = '',
    selectedId,
    enabled = true,
  }: { asOrganization?: string; search?: string; selectedId?: string; enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: ['task-reference-options', type, asOrganization, selectedId ?? null, search],
    queryFn: () =>
      listTaskReferenceOptions({ type: type!, asOrganization, id: selectedId, q: search }),
    enabled: Boolean(type) && enabled,
    // Mientras llega la búsqueda nueva, la lista anterior sigue visible en lugar de vaciarse.
    placeholderData: selectedId ? undefined : keepPreviousData,
  })
}

export function useTaskAssignmentOptions(
  officeIds: string[],
  reference?: TaskReferenceInput,
  asOrganization?: string,
  options?: { enabled?: boolean; taskId?: string }
) {
  return useQuery({
    queryKey: ['task-assignment-options', officeIds, reference, asOrganization, options?.taskId],
    queryFn: () =>
      getTaskAssignmentOptions({ officeIds, reference, asOrganization, taskId: options?.taskId }),
    enabled: options?.enabled ?? true,
  })
}
