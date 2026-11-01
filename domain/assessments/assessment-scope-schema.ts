import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'
import { ASSESSMENT_EXCLUSION_REASON_VALUES } from './asset-assessment-scope'
import { ASSESSMENT_EXCLUSION_MAX_DAYS } from '@/domain/risk/constants'

export const AssessmentScopeFieldsSchema = z.object({
  assessment_scope: z.enum(['included', 'excluded']),
  assessment_exclusion_reason: z.enum(ASSESSMENT_EXCLUSION_REASON_VALUES).nullable(),
  assessment_exclusion_note: z
    .string()
    .trim()
    .max(1000)
    .regex(...TEXT_RULES.free)
    .nullable(),
  assessment_excluded_until: z.iso.datetime({ offset: true }).nullable(),
})

export type AssessmentScopeBaseline = {
  assessment_scope?: string | null
  assessment_excluded_until?: string | null
}

export function assessmentExclusionWindowChanged(
  value: AssessmentScopeBaseline,
  original?: AssessmentScopeBaseline
) {
  return (
    original?.assessment_scope !== 'excluded' ||
    value.assessment_excluded_until !== original.assessment_excluded_until
  )
}

export function validateAssessmentScope(
  value: z.infer<typeof AssessmentScopeFieldsSchema>,
  ctx: z.RefinementCtx,
  validateWindow = true,
  now = Date.now()
) {
  if (value.assessment_scope !== 'excluded') return
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message })
  if (!value.assessment_exclusion_reason)
    issue('assessment_exclusion_reason', 'Selecciona un motivo de exclusión.')
  if (value.assessment_exclusion_reason === 'other' && !value.assessment_exclusion_note?.trim())
    issue('assessment_exclusion_note', 'Escribe una breve explicación.')
  if (!value.assessment_excluded_until) {
    issue('assessment_excluded_until', 'Selecciona una fecha de vencimiento.')
    return
  }
  const until = Date.parse(value.assessment_excluded_until)
  if (validateWindow && until <= now)
    issue('assessment_excluded_until', 'El vencimiento debe ser posterior al momento actual.')
  if (validateWindow && until > now + ASSESSMENT_EXCLUSION_MAX_DAYS * 86400000)
    issue('assessment_excluded_until', 'La exclusión no puede superar los 90 días.')
}

export const createAssessmentScopeInputSchema = (original?: AssessmentScopeBaseline) =>
  AssessmentScopeFieldsSchema.superRefine((value, ctx) =>
    validateAssessmentScope(value, ctx, assessmentExclusionWindowChanged(value, original))
  )

export const AssessmentScopeInputSchema = createAssessmentScopeInputSchema()
