import { z } from 'zod'
import { MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'
import {
  AssessmentScopeFieldsSchema,
  validateAssessmentScope,
  assessmentExclusionWindowChanged,
  type AssessmentScopeBaseline,
} from '@/domain/assessments/assessment-scope-schema'

const NonNetworkAssetFieldsSchema = z.object({
  alias: z.string().trim().min(1, 'El alias es obligatorio').max(120),
  asset_category: z.enum(MANUAL_ASSET_CATEGORY_VALUES),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  owner: z.string().min(1, 'El responsable es obligatorio'),
  location: z.string().trim().max(200).nullable(),
  status: z.enum(['active', 'retired']),
  office: z.string().min(1, 'La oficina es obligatoria'),
  // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
  // collections/NonNetworkAssets/hooks/resolveTenant.ts).
  review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
  ...AssessmentScopeFieldsSchema.shape,
})

export const createNonNetworkAssetSchema = (original?: AssessmentScopeBaseline) =>
  NonNetworkAssetFieldsSchema.superRefine((value, ctx) =>
    validateAssessmentScope(value, ctx, assessmentExclusionWindowChanged(value, original))
  )
export const NonNetworkAssetSchema = createNonNetworkAssetSchema()

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>
