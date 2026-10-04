import { z } from 'zod'
import { RISK_ASSET_TYPES } from '@/domain/risk/catalog-v2'

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

export const BulkAssessmentSelectorSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('owner'),
    risk_asset_type: z.enum(RISK_ASSET_TYPES),
    owner_id: z.string().min(1),
  }),
  z.object({
    mode: z.literal('office'),
    risk_asset_type: z.enum(RISK_ASSET_TYPES),
    office_id: z.string().min(1),
  }),
  z.object({
    mode: z.literal('organization'),
    risk_asset_type: z.enum(RISK_ASSET_TYPES),
  }),
])

export const BulkAssessmentPreviewSchema = z.object({
  selector: BulkAssessmentSelectorSchema,
})

export const BulkAssessmentCompleteSchema = z.object({
  selector: BulkAssessmentSelectorSchema,
  assessment_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .refine(ids => new Set(ids).size === ids.length, 'Assessment IDs must be unique'),
  question_set_signature: z.string().min(1).max(4000),
  answers: z.array(AssessmentAnswerDraftSchema).max(100),
})

export type SaveAssessmentDraft = z.infer<typeof SaveAssessmentDraftSchema>
export type UpdateAssessmentPolicy = z.infer<typeof UpdateAssessmentPolicySchema>
export type BulkAssessmentSelector = z.infer<typeof BulkAssessmentSelectorSchema>
export type BulkAssessmentComplete = z.infer<typeof BulkAssessmentCompleteSchema>
