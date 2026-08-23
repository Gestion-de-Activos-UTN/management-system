import { z } from 'zod'
import { safeJsonParse } from '@/lib/safe-json-parse'

// `details` es un JSON libre por categoría en el servidor (json type) — en el form se edita como
// texto (Mantine JsonInput) y se parsea a objeto recién al enviar (ver NonNetworkAssetForm.tsx),
// nunca se manda como string al PATCH/POST.
export const NonNetworkAssetSchema = z.object({
  alias: z.string().trim().min(1, 'Alias is required').max(120),
  asset_category: z.enum(['antivirus_edr', 'software_license', 'cloud_asset', 'backup', 'other']),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  owner: z.string().min(1, 'Owner is required'),
  location: z.string().trim().max(200).nullable(),
  status: z.enum(['active', 'retired']),
  office: z.string().min(1, 'Office is required'),
  // Override por-asset (siempre gana sobre OrganizationSettings.review_policy, ver
  // collections/NonNetworkAssets/hooks/resolveTenant.ts::computeNextReviewAt). Opcional: sin
  // política configurada para la organización, esta es hoy la ÚNICA forma de fijar una fecha —
  // dejarlo vacío en ese caso deja el campo en null, no rompe el submit.
  next_review_at: z.string().nullable(),
  // Texto JSON crudo del JsonInput, parseado recién al enviar (ver service.ts::toPayload) — el
  // refine acá es lo que bloquea el submit si no parsea, el `validationError` de JsonInput es
  // solo un aviso visual y no impide el submit por sí solo.
  details: z
    .string()
    .max(5000, 'Details is too large (max 5000 characters)')
    .refine(
      value => {
        try {
          safeJsonParse(value)
          return true
        } catch {
          return false
        }
      },
      { message: 'Invalid JSON' }
    ),
})

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>
