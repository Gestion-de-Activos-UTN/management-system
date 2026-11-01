'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { showApiError } from '@/lib/notify-error'
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
        notify({ color: 'green', title: 'Borrador guardado' })
      },
      onError: error => showApiError(error, 'No se pudo guardar el borrador.'),
    }),
    complete: useMutation({
      mutationFn: (data: SaveAssessmentDraft) => completeAssessment(id, data),
      onSuccess: async () => {
        await invalidate()
        notify({ color: 'green', title: 'Revisión de seguridad completada' })
      },
      onError: error => showApiError(error, 'No se pudo completar la revisión.'),
    }),
    startNewCycle: useMutation({
      mutationFn: (reason: string) => reopenAssessment(id, reason),
      onSuccess: async () => {
        await invalidate()
        notify({ color: 'green', title: 'Nuevo ciclo de revisión creado' })
      },
      onError: error => showApiError(error, 'No se pudo crear un nuevo ciclo de revisión.'),
    }),
  }
}
