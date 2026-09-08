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
        notifications.show({ color: 'green', message: 'Draft saved' })
      },
      onError: error =>
        notifications.show({ color: 'red', message: error.message || 'Could not save the draft' }),
    }),
    complete: useMutation({
      mutationFn: (data: SaveAssessmentDraft) => completeAssessment(id, data),
      onSuccess: async () => {
        await invalidate()
        notifications.show({ color: 'green', message: 'Security review completed' })
      },
      onError: error =>
        notifications.show({
          color: 'red',
          message: error.message || 'Could not complete the review',
        }),
    }),
    startNewCycle: useMutation({
      mutationFn: (reason: string) => reopenAssessment(id, reason),
      onSuccess: async () => {
        await invalidate()
        notifications.show({ color: 'green', message: 'New review cycle created' })
      },
      onError: error =>
        notifications.show({
          color: 'red',
          message: error.message || 'Could not create a new review cycle',
        }),
    }),
  }
}
