export const ASSESSMENT_SCOPE_VALUES = ['included', 'excluded'] as const
export type AssetAssessmentScope = (typeof ASSESSMENT_SCOPE_VALUES)[number]

export const ASSESSMENT_EXCLUSION_REASON_VALUES = [
  'personal_device',
  'visitor_device',
  'third_party_managed',
  'temporary_or_lab',
  'duplicate_or_misidentified',
  'contractually_out_of_scope',
  'other',
] as const
export type AssessmentExclusionReason = (typeof ASSESSMENT_EXCLUSION_REASON_VALUES)[number]

export type AssessmentScopeFields = {
  assessment_scope?: AssetAssessmentScope | null
  assessment_excluded_until?: string | null
}

// Missing values belong to rows created before this feature and must preserve the old behavior.
export function isAssetExcludedFromAssessments(
  asset: AssessmentScopeFields,
  now = new Date()
): boolean {
  if (asset.assessment_scope !== 'excluded') return false
  if (!asset.assessment_excluded_until) return true
  const excludedUntil = Date.parse(asset.assessment_excluded_until)
  return !Number.isFinite(excludedUntil) || excludedUntil > now.getTime()
}

export function assessmentScopeFields() {
  const serverResolvedAccess = { create: () => false, update: () => false }
  return [
    {
      name: 'assessment_scope',
      type: 'select' as const,
      defaultValue: 'included',
      options: [
        { label: 'Included', value: 'included' },
        { label: 'Excluded', value: 'excluded' },
      ],
      index: true,
    },
    {
      name: 'assessment_exclusion_reason',
      type: 'select' as const,
      options: ASSESSMENT_EXCLUSION_REASON_VALUES.map(value => ({ value, label: value })),
      admin: {
        condition: (_data: unknown, siblingData: AssessmentScopeFields) =>
          siblingData.assessment_scope === 'excluded',
      },
    },
    {
      name: 'assessment_exclusion_note',
      type: 'textarea' as const,
      maxLength: 1000,
      admin: {
        condition: (_data: unknown, siblingData: AssessmentScopeFields) =>
          siblingData.assessment_scope === 'excluded',
      },
    },
    {
      // null means that the exclusion has no expiration date.
      name: 'assessment_excluded_until',
      type: 'date' as const,
      admin: {
        condition: (_data: unknown, siblingData: AssessmentScopeFields) =>
          siblingData.assessment_scope === 'excluded',
      },
    },
    {
      name: 'assessment_excluded_at',
      type: 'date' as const,
      admin: { readOnly: true },
      access: serverResolvedAccess,
    },
    {
      name: 'assessment_excluded_by',
      type: 'relationship' as const,
      relationTo: 'users' as const,
      admin: { readOnly: true },
      access: serverResolvedAccess,
    },
  ]
}
