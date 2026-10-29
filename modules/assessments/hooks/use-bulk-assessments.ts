'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import type { BulkAssessmentComplete, BulkAssessmentSelector } from '../schema'
import { completeBulkAssessments, previewBulkAssessments } from '../service'
import { showApiError } from '@/lib/notify-error'

export function useBulkAssessments() {
  const queryClient = useQueryClient()
  const preview = useMutation({
    mutationFn: (selector: BulkAssessmentSelector) => previewBulkAssessments(selector),
    onError: error => showApiError(error, 'No se pudieron preparar las revisiones seleccionadas'),
  })
  const complete = useMutation({
    mutationFn: (command: BulkAssessmentComplete) => completeBulkAssessments(command),
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assessments'] }),
        queryClient.invalidateQueries({ queryKey: ['risk'] }),
      ])
      notify({
        color: 'green',
        title: `${result.completed} ${result.completed === 1 ? 'revisión completada' : 'revisiones completadas'}`,
      })
    },
    onError: error => showApiError(error, 'No se pudieron completar las revisiones'),
  })
  return { preview, complete }
}
