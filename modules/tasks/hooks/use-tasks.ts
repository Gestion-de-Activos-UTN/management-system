'use client'

import { useQuery } from '@tanstack/react-query'
import { getTask, listTasks } from '../service'

export function useTasks(params: Parameters<typeof listTasks>[0]) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => listTasks(params),
  })
}

export function useTask(id: string, asOrganization?: string) {
  return useQuery({
    queryKey: ['tasks', id, asOrganization],
    queryFn: () => getTask(id, asOrganization),
    enabled: Boolean(id),
  })
}
