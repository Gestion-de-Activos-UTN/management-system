import { z } from 'zod'
import { categoryHasSoftware, MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'

export const NonNetworkAssetSchema = z
  .object({
    alias: z.string().trim().min(1, 'Alias is required').max(120),
    asset_category: z.enum(MANUAL_ASSET_CATEGORY_VALUES),
    criticality: z.enum(['low', 'medium', 'high', 'critical']),
    owner: z.string().min(1, 'Owner is required'),
    location: z.string().trim().max(200).nullable(),
    status: z.enum(['active', 'retired']),
    office: z.string().min(1, 'Office is required'),
    // Topes espejados de collections/NonNetworkAssets/index.ts, que a su vez los toma de
    // contracts/asset.schema.ts. Nullable y no optional: el form siempre los manda, en null
    // cuando la categoría no tiene software.
    software_vendor: z.string().trim().max(120).nullable(),
    software_product: z.string().trim().max(240).nullable(),
    software_version: z.string().trim().max(120).nullable(),
    // next_review_at ya no se edita a mano — se deriva de este intervalo (ver
    // collections/NonNetworkAssets/hooks/resolveTenant.ts).
    review_interval: z.enum(['never', '1d', '3d', '1w', '1m', '6m', '1y']),
  })
  // Mismo criterio que assertSoftwareIdentityComplete en el beforeChange del server, incluida la
  // guarda por categoría — SYSTEM_PROMPT.md #5: la validación de cliente y la de servidor no
  // pueden divergir. Acá es UX (marca el input); la autoridad sigue siendo el hook.
  .superRefine((asset, ctx) => {
    if (!categoryHasSoftware(asset.asset_category)) return
    const blank = (value: string | null) => !value || !value.trim()
    if (blank(asset.software_vendor) === blank(asset.software_product)) return
    ctx.addIssue({
      code: 'custom',
      path: [blank(asset.software_vendor) ? 'software_vendor' : 'software_product'],
      message: 'Vendor and product must be filled in together.',
    })
  })

export type NonNetworkAssetFormValues = z.infer<typeof NonNetworkAssetSchema>
