import { z } from 'zod'
import { TEXT_RULES } from '@/lib/text-rules'
import { MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'
import {
  AssessmentScopeFieldsSchema,
  validateAssessmentScope,
  assessmentExclusionWindowChanged,
  type AssessmentScopeBaseline,
} from '@/domain/assessments/assessment-scope-schema'
import { resolveCategoryGroups } from '@/collections/NonNetworkAssets/categoryGroupRules'

const text = (max: number) => z.string().trim().max(max).nullish()

export const NonNetworkAssetFieldsSchema = z
  .object({
    alias: z.string().trim().min(1, 'El alias es obligatorio').max(120).regex(...TEXT_RULES.label),
    asset_category: z.enum(MANUAL_ASSET_CATEGORY_VALUES),
    // El form conserva los tres grupos en estado, pero envía solo el correspondiente a la categoría.
    // Los campos obligatorios se validan en superRefine con las reglas compartidas del servidor.
    // Topes alineados con collections/NonNetworkAssets/index.ts.
    product_details: z
      .object({
        software_vendor: text(120),
        software_product: text(240),
        software_version: text(120),
      })
      .optional(),
    cloud_details: z
      .object({
        kind: z.enum(['productivity_identity', 'infrastructure', 'domain_dns']).nullish(),
        vendor: text(120),
      })
      .optional(),
    repository_details: z
      .object({
        kind: z
          .enum(['source_code', 'secrets_vault', 'corporate_email', 'database', 'other_digital'])
          .nullish(),
      })
      .optional(),
    notes: text(1000),
    criticality: z.enum(['low', 'medium', 'high', 'critical']),
    owner: z.string().min(1, 'El responsable es obligatorio').nullable(),
    location: z.string().trim().max(200).regex(...TEXT_RULES.label).nullable(),
    status: z.enum(['active', 'retired']),
    office: z.string().min(1, 'La oficina es obligatoria'),
    // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
    // collections/NonNetworkAssets/hooks/resolveTenant.ts).
    review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
    ...AssessmentScopeFieldsSchema.shape,
    /* assessment_scope: z.enum(['included', 'excluded']),
    assessment_exclusion_reason: z.enum(ASSESSMENT_EXCLUSION_REASON_VALUES).nullable(),
    assessment_exclusion_note: z.string().trim().max(1000).nullable(),
    assessment_excluded_until: z.iso.datetime().nullable(), */
  })

export const createNonNetworkAssetSchema = (original?: AssessmentScopeBaseline) =>
  NonNetworkAssetFieldsSchema.superRefine((value, ctx) => {
    validateAssessmentScope(
      value,
      ctx,
      assessmentExclusionWindowChanged(value, original)
    )
    for (const { path, message } of resolveCategoryGroups(value, null).errors) {
      ctx.addIssue({
        code: 'custom',
        path: path.split('.'),
        message
      })
    }
  })

export const NonNetworkAssetSchema = createNonNetworkAssetSchema()

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>

/* .superRefine((value, ctx) => {
  if (value.assessment_scope === 'excluded' && !value.assessment_exclusion_reason)
    ctx.addIssue({
      code: 'custom',
      path: ['assessment_exclusion_reason'],
      message: 'Selecciona un motivo',
    })
  if (
    value.assessment_scope === 'excluded' &&
    value.assessment_exclusion_reason === 'other' &&
    !value.assessment_exclusion_note
  )
    ctx.addIssue({
      code: 'custom',
      path: ['assessment_exclusion_note'],
      message: 'Agrega una breve explicación',
    })

  // Misma regla que el beforeChange del servidor: un solo lugar donde viven los obligatorios.
  for (const { path, message } of resolveCategoryGroups(value, null).errors)
    ctx.addIssue({ code: 'custom', path: path.split('.'), message })
}) */
/* import {
  AssessmentScopeFieldsSchema,
  validateAssessmentScope,
  assessmentExclusionWindowChanged,
  type AssessmentScopeBaseline,
} from '@/domain/assessments/assessment-scope-schema' */

/* const NonNetworkAssetFieldsSchema = z.object({
  alias: z.string().trim().min(1, 'El alias es obligatorio').max(120),
  asset_category: z.enum(MANUAL_ASSET_CATEGORY_VALUES),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  // null = "Sin responsable": sólo lo pone el sistema (persona desactivada, activo movido de una
  // oficina desactivada). Se puede conservar al editar; elegirlo no (la opción está deshabilitada).
  owner: z.string().min(1, 'El responsable es obligatorio').nullable(),
  location: z
    .string()
    .trim()
    .max(200)
    .regex(...TEXT_RULES.label)
    .nullable(),
  status: z.enum(['active', 'retired']),
  office: z.string().min(1, 'La oficina es obligatoria'),
  // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
  // collections/NonNetworkAssets/hooks/resolveTenant.ts).
  review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
  ...AssessmentScopeFieldsSchema.shape,
}) */

/* export const createNonNetworkAssetSchema = (original?: AssessmentScopeBaseline) =>
  NonNetworkAssetFieldsSchema.superRefine((value, ctx) =>
    validateAssessmentScope(value, ctx, assessmentExclusionWindowChanged(value, original))
  )
export const NonNetworkAssetSchema = createNonNetworkAssetSchema() */

/* export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema> */
