import type { CollectionBeforeChangeHook } from 'payload'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'

export const validateAssetAssessmentScope: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const currentScope = originalDoc?.assessment_scope ?? 'included'
  const scope = data?.assessment_scope ?? currentScope
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

  const reason = data?.assessment_exclusion_reason ?? originalDoc?.assessment_exclusion_reason
  const note = data?.assessment_exclusion_note ?? originalDoc?.assessment_exclusion_note
  if (!reason) throw new Error('Excluded assets require an exclusion reason')
  if (reason === 'other' && !String(note ?? '').trim())
    throw new Error('The “other” exclusion reason requires a note')

  const until = data?.assessment_excluded_until ?? originalDoc?.assessment_excluded_until ?? null
  if (until && !Number.isFinite(Date.parse(until)))
    throw new Error('Assessment exclusion expiration is invalid')
  if (
    until &&
    (changed || 'assessment_excluded_until' in (data ?? {})) &&
    Date.parse(until) <= Date.now()
  )
    throw new Error('Assessment exclusion expiration must be in the future')

  if (!changed) return data
  const ctx = await getTenantContext(req)
  return {
    ...data,
    assessment_excluded_at: new Date().toISOString(),
    assessment_excluded_by: ctx?.userId ?? null,
  }
}
