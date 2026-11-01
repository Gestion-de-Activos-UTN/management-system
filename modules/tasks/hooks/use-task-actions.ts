'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { notify } from '@/lib/notify'
import type { HttpError } from '@/lib/http-client'
import { showApiError } from '@/lib/notify-error'
import type { CreateTasksInput, EditTaskInput, ReassignTaskInput } from '../schema'
import { createTaskCommandGate } from '../task-command-gate'
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
    onError: async error => {
      // La entidad dejó de estar disponible: TaskForm lo muestra debajo de su campo.
      if (error.code === 'asset_unavailable') return
      if (error.code !== 'task_operation_conflict')
        return showApiError(error, 'No se pudo crear la tarea')
      // Un intento anterior de este formulario ya se guardó (p. ej. se perdió su respuesta).
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      notify({
        color: 'yellow',
        title: 'La tarea ya estaba creada',
        message:
          'Se guardó con los datos del primer intento. Edítala desde la lista si hace falta.',
      })
    },
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
  const [gate] = useState(createTaskCommandGate<TaskAction>)
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

  const mutateAsync: typeof mutation.mutateAsync = (variables, options) =>
    gate(variables.action, () => mutation.mutateAsync(variables, options))
  const mutate: typeof mutation.mutate = (variables, options) => {
    void mutateAsync(variables, options).catch(() => {
      // The mutation reports the error; event handlers must not create unhandled rejections.
    })
  }
  return { ...mutation, mutate, mutateAsync }
}
