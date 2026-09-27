'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { SaveAssessmentDraft } from '../schema'
import { completeAssessment, reopenAssessment, saveAssessmentDraft } from '../service'

export function useAssessmentActions(id: string) {
  const queryClient = useQueryClient()
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['assessments'] })
  }
  return {
    saveDraft: useMutation({
      mutationFn: (data: SaveAssessmentDraft) => saveAssessmentDraft(id, data),
      onSuccess: async () => {
        await invalidate()
        notifications.show({ color: 'green', message: 'Borrador guardado' })
      },
      onError: error =>
        notifications.show({
          color: 'red',
          message: error.message || 'No se pudo guardar el borrador',
        }),
    }),
    complete: useMutation({
      mutationFn: (data: SaveAssessmentDraft) => completeAssessment(id, data),
      onSuccess: async () => {
        await invalidate()
        notifications.show({ color: 'green', message: 'Revisión de seguridad completada' })
      },
      onError: error =>
        notifications.show({
          color: 'red',
          message: error.message || 'No se pudo completar la revisión',
        }),
    }),
    startNewCycle: useMutation({
      mutationFn: (reason: string) => reopenAssessment(id, reason),
      onSuccess: async () => {
        await invalidate()
        notifications.show({ color: 'green', message: 'Nuevo ciclo de revisión creado' })
      },
      onError: error =>
        notifications.show({
          color: 'red',
          message: error.message || 'No se pudo crear un nuevo ciclo de revisión',
        }),
    }),
  }
}
