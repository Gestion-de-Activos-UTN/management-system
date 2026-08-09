import { z } from 'zod'

// Mapeo 1:1 contra scanner-prototype/src/siam_agent/models.py::Service — no agregar/renombrar campos acá,
// eso rompería al agente ya desplegado (documentation/08-platform-scanner-communication.md §8.1).
export const ServiceSchema = z.object({
  port: z.number().int(),
  protocol: z.string(),
  state: z.string(),
  name: z.string(),
  product: z.string(),
  version: z.string(),
  extra_info: z.string(),
  cpe: z.string(),
})

// Mapeo 1:1 contra models.py::OperatingSystem.
export const OperatingSystemSchema = z.object({
  name: z.string(),
  accuracy: z.number().int(),
  cpe: z.array(z.string()),
})

// Mapeo 1:1 contra models.py::Asset. .passthrough() = permisivo-en-lectura (doc 08.2):
// un campo extra que un agente más nuevo mande no rechaza el payload — ver domain/inventories/ingestScanReport.ts
// para el paso de saneo que evita que ese extra llegue a persistirse.
export const AssetPayloadSchema = z
  .object({
    asset_id: z.string(),
    agent_id: z.string(),
    ip: z.string(),
    mac: z.string(),
    vendor: z.string(),
    hostname: z.string(),
    os: OperatingSystemSchema.nullable(),
    services: z.array(ServiceSchema),
    scan_time: z.string(),
  })
  .passthrough()

export type AssetPayload = z.infer<typeof AssetPayloadSchema>
