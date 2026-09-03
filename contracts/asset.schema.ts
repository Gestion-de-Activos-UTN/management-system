import { z } from 'zod'

// Mapeo 1:1 contra scanner-prototype/src/siam_agent/models.py::Service — no renombrar campos
// existentes acá, eso rompería al agente ya desplegado (documentation/08-platform-scanner-communication.md
// §8.1). Los campos nuevos llevan .default() para que reportes de agentes viejos sigan validando.
export const ServiceSchema = z.object({
  port: z.number().int(),
  protocol: z.string(),
  state: z.string(),
  name: z.string(),
  product: z.string(),
  version: z.string(),
  extra_info: z.string(),
  cpe: z.string(),
  // Por qué nmap cree que el puerto está en ese estado, ej. "syn-ack", "reset".
  reason: z.string().default(''),
  // "probed" = nmap sondeó y confirmó el servicio; "table" = inferido solo por el número de
  // puerto (nmap-services), bastante menos confiable.
  detection_method: z.string().default('table'),
  // Confianza de nmap en la detección del servicio, 0-10 (su campo "conf").
  confidence: z.number().int().min(0).max(10).default(0),
  // "ssl" cuando el servicio corre dentro de un túnel cifrado (ej. HTTPS sobre un puerto no 443).
  tunnel: z.string().default(''),
  // Salida de scripts NSE (-sC) para este puerto: id de script -> output crudo.
  scripts: z.record(z.string(), z.string()).default({}),
})

// Mapeo 1:1 contra models.py::OperatingSystem.
export const OperatingSystemSchema = z.object({
  name: z.string(),
  accuracy: z.number().int(),
  cpe: z.array(z.string()),
  osfamily: z.string().default(''),
  osgen: z.string().default(''),
  vendor: z.string().default(''),
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
    // Hasta 3 candidatos de SO que reportó nmap, orden descendente por accuracy. os_candidates[0]
    // == os cuando ambos están presentes; default [] cubre agentes viejos que no lo mandan.
    os_candidates: z.array(OperatingSystemSchema).default([]),
    // Por qué nmap considera "up" al host (ej. "arp-response", "echo-reply"), no solo el estado.
    state_reason: z.string().default(''),
    // Salida de scripts NSE a nivel host (ej. smb-os-discovery): id de script -> output crudo.
    host_scripts: z.record(z.string(), z.string()).default({}),
  })
  .passthrough()

export type AssetPayload = z.infer<typeof AssetPayloadSchema>
