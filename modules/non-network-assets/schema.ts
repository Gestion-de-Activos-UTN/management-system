import { z } from 'zod'
import { MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'
import { ASSESSMENT_EXCLUSION_REASON_VALUES } from '@/domain/assessments/asset-assessment-scope'

export const NonNetworkAssetSchema = z
  .object({
    alias: z.string().trim().min(1, 'Alias is required').max(120),
    asset_category: z.enum(MANUAL_ASSET_CATEGORY_VALUES),
    criticality: z.enum(['low', 'medium', 'high', 'critical']),
    owner: z.string().min(1, 'Owner is required'),
    location: z.string().trim().max(200).nullable(),
    status: z.enum(['active', 'retired']),
    office: z.string().min(1, 'Office is required'),
    // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
    // collections/NonNetworkAssets/hooks/resolveTenant.ts).
    review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
    assessment_scope: z.enum(['included', 'excluded']),
    assessment_exclusion_reason: z.enum(ASSESSMENT_EXCLUSION_REASON_VALUES).nullable(),
    assessment_exclusion_note: z.string().trim().max(1000).nullable(),
    assessment_excluded_until: z.iso.datetime().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.assessment_scope === 'excluded' && !value.assessment_exclusion_reason)
      ctx.addIssue({
        code: 'custom',
        path: ['assessment_exclusion_reason'],
        message: 'Choose a reason',
      })
    if (
      value.assessment_scope === 'excluded' &&
      value.assessment_exclusion_reason === 'other' &&
      !value.assessment_exclusion_note
    )
      ctx.addIssue({
        code: 'custom',
        path: ['assessment_exclusion_note'],
        message: 'Add a short explanation',
      })
  })

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>
