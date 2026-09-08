import { z } from 'zod'
import { SCANNED_ASSET_TYPE_VALUES } from '@/domain/assets/asset-types'

// No extiende contracts/asset.schema.ts: ese schema es el contrato Scanner↔Plataforma para el
// bloque TÉCNICO (ip/mac/os/services...) — el bloque de negocio nunca viaja en ese payload, no
// hay nada ahí para extender. Este schema valida exactamente lo que el PATCH de edición manual
// acepta (RF-55: solo negocio, nunca los campos técnicos).
export const AssetBusinessFieldsSchema = z.object({
  authorization_status: z.enum(['authorized', 'unauthorized']),
  alias: z.string().trim().max(120).nullable(),
  criticality: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
  owner: z.string().nullable(),
  location: z.string().trim().max(200).nullable(),
  status: z.enum(['active', 'retired', 'offline']),
})

export type AssetBusinessFields = z.infer<typeof AssetBusinessFieldsSchema>
export const AssetBusinessUpdateSchema = AssetBusinessFieldsSchema.partial().strict()

export const AssetTypeSchema = z.enum(SCANNED_ASSET_TYPE_VALUES)

export const AssetIdentificationSchema = z
  .object({
    confirmed_type: AssetTypeSchema,
    authorization_status: z.enum(['authorized', 'unauthorized']),
    owner: z
      .string()
      .refine(value => value !== '__unknown__', 'Unknown owner must be represented as null')
      .nullable()
      .optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
    alias: z.string().trim().max(120).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
  })
  .strict()

export type AssetIdentification = z.infer<typeof AssetIdentificationSchema>

export const UNKNOWN_IDENTIFICATION_VALUE = '__unknown__' as const

// El formulario necesita conservar la opción explícita seleccionada. Ese valor nunca cruza la
// frontera HTTP: AssetIdentificationModal lo normaliza a `null` antes de llamar al endpoint.
export const AssetIdentificationFormSchema = AssetIdentificationSchema.extend({
  owner: z.string().nullable().optional(),
  criticality: z
    .union([z.enum(['low', 'medium', 'high', 'critical']), z.literal(UNKNOWN_IDENTIFICATION_VALUE)])
    .nullable()
    .optional(),
})

export type AssetIdentificationForm = z.infer<typeof AssetIdentificationFormSchema>

export function normalizeAssetIdentificationForm(
  value: AssetIdentificationForm
): AssetIdentification {
  return AssetIdentificationSchema.parse({
    ...value,
    owner: value.owner === UNKNOWN_IDENTIFICATION_VALUE ? null : value.owner,
    criticality: value.criticality === UNKNOWN_IDENTIFICATION_VALUE ? null : value.criticality,
  })
}
