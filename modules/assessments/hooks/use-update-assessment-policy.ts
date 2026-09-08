'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAssessmentPolicy } from '../service'
import type { UpdateAssessmentPolicy } from '../schema'

export function useUpdateAssessmentPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateAssessmentPolicy) => updateAssessmentPolicy(data),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organization-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['assessments'] }),
      ])
    },
  })
}
