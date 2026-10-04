'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { BulkAssessmentComplete, BulkAssessmentSelector } from '../schema'
import { completeBulkAssessments, previewBulkAssessments } from '../service'
import { showApiError } from '@/lib/notify-error'

export function useBulkAssessments() {
  const queryClient = useQueryClient()
  const preview = useMutation({
    mutationFn: (selector: BulkAssessmentSelector) => previewBulkAssessments(selector),
    onError: error => showApiError(error, 'No se pudo preparar la respuesta masiva'),
  })
  const complete = useMutation({
    mutationFn: (command: BulkAssessmentComplete) => completeBulkAssessments(command),
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assessments'] }),
        queryClient.invalidateQueries({ queryKey: ['risk'] }),
      ])
      notifications.show({
        color: 'green',
        message: `${result.completed} ${result.completed === 1 ? 'revisión completada' : 'revisiones completadas'}`,
      })
    },
    onError: error => showApiError(error, 'No se pudieron completar las revisiones'),
  })
  return { preview, complete }
}
