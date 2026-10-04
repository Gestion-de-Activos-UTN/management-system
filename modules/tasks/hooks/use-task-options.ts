'use client'

import { useQuery } from '@tanstack/react-query'
import type { TaskReferenceInput } from '../schema'
import { getTaskAssignmentOptions, listTaskReferenceOptions } from '../service'

export function useTaskReferenceOptions(
  type: TaskReferenceInput['relationTo'] | null,
  officeId?: string | null,
  asOrganization?: string,
  selectedId?: string
) {
  return useQuery({
    queryKey: ['task-reference-options', type, officeId, asOrganization, selectedId],
    queryFn: () =>
      listTaskReferenceOptions({ type: type!, officeId, asOrganization, id: selectedId }),
    enabled: Boolean(type),
  })
}

export function useTaskAssignmentOptions(
  officeIds: string[],
  reference?: TaskReferenceInput,
  asOrganization?: string
) {
  return useQuery({
    queryKey: ['task-assignment-options', officeIds, reference, asOrganization],
    queryFn: () => getTaskAssignmentOptions({ officeIds, reference, asOrganization }),
  })
}
