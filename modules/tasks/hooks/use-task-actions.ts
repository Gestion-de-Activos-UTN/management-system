'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import type { CreateTasksInput, EditTaskInput, ReassignTaskInput } from '../schema'
import {
  cancelTask,
  createTasks,
  deleteTask,
  editTask,
  forceCompleteTask,
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
      notify({ color: 'green', title: 'Tarea creada' })
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
      notify({ color: 'green', title: 'Tarea actualizada' })
    },
    onError: error => showApiError(error, 'No se pudo actualizar la tarea'),
  })
}

export function useTaskCommand(id: string) {
  const queryClient = useQueryClient()
  const inFlight = useRef<Promise<unknown> | null>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
  const mutation = useMutation<unknown, HttpError, { action: TaskAction; payload?: unknown }>({
    mutationFn: ({ action, payload }) => {
      if (action === 'delete') return deleteTask(id)
      if (action === 'cancel') return cancelTask(id, String(payload ?? ''))
      if (action === 'force_complete') return forceCompleteTask(id, String(payload ?? ''))
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
        force_complete: 'Tarea completada por administración',
        cancel: 'Tarea cancelada',
        archive: 'Tarea archivada',
        delete: 'Tarea eliminada',
        reassign: 'Tarea reasignada',
      }
      notify({
        color: 'green',
        title: labels[variables.action] ?? 'Tarea actualizada',
      })
    },
    onError: async (error, { action }) => {
      const actions: Record<TaskAction, string> = {
        claim: 'No se pudo reclamar la tarea',
        release: 'No se pudo liberar la tarea',
        complete: 'No se pudo completar la tarea',
        force_complete: 'No se pudo completar la tarea por administración',
        cancel: 'No se pudo cancelar la tarea',
        archive: 'No se pudo archivar la tarea',
        delete: 'No se pudo eliminar la tarea',
        reassign: 'No se pudo reasignar la tarea',
        edit: 'No se pudo editar la tarea',
      }
      showApiError(error, actions[action])
      // A stale screen must refresh after a rejected command too, before enabling actions again.
      await invalidate()
    },
  })

  const mutateAsync: typeof mutation.mutateAsync = (variables, options) => {
    if (inFlight.current) return inFlight.current
    const pending = mutation.mutateAsync(variables, options)
    inFlight.current = pending
    const release = () => {
      if (inFlight.current === pending) inFlight.current = null
    }
    void pending.then(release, release)
    return pending
  }
  const mutate: typeof mutation.mutate = (variables, options) => {
    void mutateAsync(variables, options).catch(() => {
      // The mutation reports the error; event handlers must not create unhandled rejections.
    })
  }
  return { ...mutation, mutate, mutateAsync }
}
