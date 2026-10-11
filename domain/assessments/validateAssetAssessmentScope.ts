import { ValidationError, type CollectionBeforeChangeHook } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import {
  AssessmentScopeFieldsSchema,
  validateAssessmentScope,
  assessmentExclusionWindowChanged,
} from './assessment-scope-schema'

export const validateAssetAssessmentScope: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const currentScope = originalDoc?.assessment_scope ?? 'included'
  const effective = { ...originalDoc, ...data }
  const scope = effective.assessment_scope === undefined ? 'included' : effective.assessment_scope
  const changed = 'assessment_scope' in (data ?? {}) && scope !== currentScope

  if (scope === 'included') {
    return {
      ...data,
      assessment_exclusion_reason: null,
      assessment_exclusion_note: null,
      assessment_excluded_until: null,
      assessment_excluded_at: null,
      assessment_excluded_by: null,
    }
  }

  const validateWindow = assessmentExclusionWindowChanged(effective, originalDoc)
  const parsed = AssessmentScopeFieldsSchema.superRefine((value, ctx) =>
    validateAssessmentScope(value, ctx, validateWindow)
  ).safeParse({
    assessment_scope: scope,
    assessment_exclusion_reason: effective.assessment_exclusion_reason ?? null,
    assessment_exclusion_note: effective.assessment_exclusion_note ?? null,
    assessment_excluded_until: effective.assessment_excluded_until ?? null,
  })
  if (!parsed.success)
    throw new ValidationError({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })

  if (!changed) return data
  const ctx = await getTenantContext(req)
  return {
    ...data,
    assessment_excluded_at: new Date().toISOString(),
    assessment_excluded_by: ctx?.userId ?? null,
  }
}
