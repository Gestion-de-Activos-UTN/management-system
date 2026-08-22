import { z } from 'zod';

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
});

export type AssetBusinessFields = z.infer<typeof AssetBusinessFieldsSchema>;
