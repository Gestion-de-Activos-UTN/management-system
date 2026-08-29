import { z } from 'zod'

export const NonNetworkAssetSchema = z.object({
  alias: z.string().trim().min(1, 'Alias is required').max(120),
  asset_category: z.enum(['antivirus_edr', 'software_license', 'cloud_asset', 'backup', 'other']),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  owner: z.string().min(1, 'Owner is required'),
  location: z.string().trim().max(200).nullable(),
  status: z.enum(['active', 'retired']),
  office: z.string().min(1, 'Office is required'),
  // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
  // collections/NonNetworkAssets/hooks/resolveTenant.ts).
  review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
})

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>
