import { z } from 'zod'
import { SCANNED_ASSET_TYPE_VALUES } from '@/domain/assets/asset-types'

// No extiende contracts/asset.schema.ts: ese schema es el contrato Scanner↔Plataforma para el
// bloque TÉCNICO (ip/mac/os/services...) — el bloque de negocio nunca viaja en ese payload, no
// hay nada ahí para extender. Este schema valida exactamente lo que el PATCH de edición manual
// acepta (RF-55: solo negocio, nunca los campos técnicos).
export const AssetBusinessFieldsSchema = z.object({
  alias: z.string().trim().max(120).nullable(),
  criticality: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
  owner: z.string().nullable(),
  location: z.string().trim().max(200).nullable(),
  status: z.enum(['active', 'retired', 'offline']),
})

export type AssetBusinessFields = z.infer<typeof AssetBusinessFieldsSchema>

export const AssetTypeSchema = z.enum(SCANNED_ASSET_TYPE_VALUES)

export const AssetIdentificationSchema = z
  .object({
    confirmed_type: AssetTypeSchema,
    authorization_status: z.enum(['authorized', 'unauthorized']),
    owner: z.string().nullable().optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
    alias: z.string().trim().max(120).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.authorization_status !== 'authorized') return
    if (!value.owner)
      ctx.addIssue({
        code: 'custom',
        path: ['owner'],
        message: 'Owner is required for an authorized asset',
      })
    if (!value.criticality)
      ctx.addIssue({
        code: 'custom',
        path: ['criticality'],
        message: 'Criticality is required for an authorized asset',
      })
  })

export type AssetIdentification = z.infer<typeof AssetIdentificationSchema>
