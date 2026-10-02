'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import type { CreateTasksInput, EditTaskInput, ReassignTaskInput } from '../schema'
import {
  cancelTask,
  createTasks,
  deleteTask,
  editTask,
  reassignTask,
  taskCommand,
  type TaskAction,
} from '../service'

export function useCreateTasks() {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, CreateTasksInput>({
    mutationFn: createTasks,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      notifications.show({ color: 'green', message: 'Tarea creada' })
    },
    onError: error => showApiError(error, 'No se pudo crear la tarea'),
  })
}

export function useEditTask(id: string) {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, EditTaskInput>({
    mutationFn: input => editTask(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      notifications.show({ color: 'green', message: 'Tarea actualizada' })
    },
    onError: error => showApiError(error, 'No se pudo actualizar la tarea'),
  })
}

export function useTaskCommand(id: string) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  return useMutation<unknown, HttpError, { action: TaskAction; payload?: unknown }>({
    mutationFn: ({ action, payload }) => {
      if (action === 'delete') return deleteTask(id)
      if (action === 'cancel') return cancelTask(id, String(payload ?? ''))
      if (action === 'reassign') return reassignTask(id, payload as ReassignTaskInput)
      if (action === 'edit') throw new Error('Edit uses useEditTask')
      return taskCommand(id, action)
    },
    onSuccess: async (_data, variables) => {
      await invalidate()
      const labels: Partial<Record<TaskAction, string>> = {
        claim: 'Tarea reclamada',
        release: 'Tarea liberada',
        complete: 'Tarea completada',
        cancel: 'Tarea cancelada',
        archive: 'Tarea archivada',
        delete: 'Tarea eliminada',
        reassign: 'Tarea reasignada',
      }
      notifications.show({
        color: 'green',
        message: labels[variables.action] ?? 'Tarea actualizada',
      })
    },
    onError: error => showApiError(error, 'No se pudo realizar la acción'),
  })
}
