import { z } from 'zod'

export const AssessmentScopeSchema = z.enum(['organization', 'office', 'asset'])

export const AssessmentListQuerySchema = z.object({
  scope: AssessmentScopeSchema.optional(),
  office_id: z.string().min(1).optional(),
  asset_id: z.string().min(1).optional(),
})

export const AssessmentAnswerDraftSchema = z
  .object({
    question_key: z.string().min(1).max(160),
    question_version: z.number().int().positive(),
    option_key: z.string().min(1).max(160),
    justification: z.string().trim().max(2000).optional(),
    evidence_note: z.string().trim().max(4000).optional(),
  })
  .superRefine((answer, ctx) => {
    if (answer.option_key === 'not_applicable' && !answer.justification) {
      ctx.addIssue({
        code: 'custom',
        path: ['justification'],
        message: 'Explica brevemente por qué no aplica.',
      })
    }
  })

export const SaveAssessmentDraftSchema = z.object({
  answers: z.array(AssessmentAnswerDraftSchema).max(100),
})

export const CompleteAssessmentSchema = SaveAssessmentDraftSchema

export const ReopenAssessmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

export const UpdateAssessmentPolicySchema = z.object({
  policy_key: z.enum(['essential', 'reinforced']),
  policy_version: z.number().int().positive(),
})

export type SaveAssessmentDraft = z.infer<typeof SaveAssessmentDraftSchema>
export type UpdateAssessmentPolicy = z.infer<typeof UpdateAssessmentPolicySchema>
