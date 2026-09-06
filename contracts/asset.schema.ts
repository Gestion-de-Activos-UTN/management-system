import { z } from 'zod'

export const CoverageStatusSchema = z.enum(['complete', 'partial', 'not_attempted', 'unknown'])

export const ScanIssueSchema = z
  .object({
    stage: z.enum([
      'discovery',
      'port_scan',
      'service_detection',
      'os_detection',
      'name_resolution',
      'routing',
      'scanner',
    ]),
    code: z.enum([
      'host_timeout',
      'permission_denied',
      'tool_unavailable',
      'resolution_timeout',
      'parse_error',
      'route_ambiguous',
      'execution_error',
      'other',
    ]),
  })
  .strict()

export const AssetCoverageSchema = z
  .object({
    port_scan: CoverageStatusSchema,
    service_detection: CoverageStatusSchema,
    os_detection: CoverageStatusSchema,
    name_resolution: CoverageStatusSchema,
  })
  .strict()

export const NameEvidenceSchema = z
  .object({
    value: z.string().trim().min(1).max(253),
    source: z.enum(['nmap', 'ptr', 'mdns', 'netbios', 'ssdp']),
  })
  .strict()

export const MacMetadataSchema = z
  .object({
    kind: z.enum([
      'globally_administered',
      'locally_administered',
      'multicast',
      'broadcast',
      'invalid',
      'unknown',
    ]),
    vendor_resolution: z.enum(['resolved', 'not_found', 'not_attempted', 'unknown']),
  })
  .strict()

// Mapeo 1:1 contra scanner-prototype/src/siam_agent/models.py::Service.
export const ServiceSchema = z
  .object({
    port: z.number().int().min(0).max(65535),
    protocol: z.enum(['tcp', 'udp', 'sctp', 'ip']),
    state: z.enum([
      'open',
      'closed',
      'filtered',
      'unfiltered',
      'open|filtered',
      'closed|filtered',
      'unknown',
    ]),
    name: z.string().max(120),
    product: z.string().max(240),
    version: z.string().max(120),
    extra_info: z.string().max(500),
    cpe: z.string().max(500),
    // Por qué nmap cree que el puerto está en ese estado, ej. "syn-ack", "reset".
    reason: z.string().max(120),
    // "probed" = nmap sondeó y confirmó el servicio; "table" = inferido solo por el número de
    // puerto (nmap-services), bastante menos confiable.
    detection_method: z.enum(['probed', 'table', 'unknown']),
    // Confianza de nmap en la detección del servicio, 0-10 (su campo "conf").
    confidence: z.number().int().min(0).max(10),
    // "ssl" cuando el servicio corre dentro de un túnel cifrado (ej. HTTPS sobre un puerto no 443).
    tunnel: z.string().max(40),
    // Salida de scripts NSE (-sC) para este puerto: id de script -> output crudo.
    scripts: z.record(z.string().max(120), z.string().max(4000)),
  })
  .strict()

// Mapeo 1:1 contra models.py::OperatingSystem.
export const OperatingSystemSchema = z
  .object({
    name: z.string().max(240),
    accuracy: z.number().int().min(0).max(100),
    cpe: z.array(z.string().max(500)).max(20),
    osfamily: z.string().max(120),
    osgen: z.string().max(120),
    vendor: z.string().max(120),
    // Clasificación cruda de osclass.type informada por Nmap. Default mantiene compatibilidad
    // con agentes anteriores que todavía no envían el campo.
    device_type: z.string().max(120),
  })
  .strict()

// Mapeo 1:1 estricto contra models.py::Asset. La plataforma sigue saneando explícitamente antes
// de persistir para mantener separado el contrato HTTP del modelo de Assets.
export const AssetPayloadSchema = z
  .object({
    asset_id: z.string().min(1).max(120),
    agent_id: z.string().min(1).max(120),
    ip: z.ipv4(),
    mac: z.union([z.literal(''), z.string().regex(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/)]),
    vendor: z.string().max(240),
    hostname: z.string().max(253),
    os: OperatingSystemSchema.nullable(),
    services: z.array(ServiceSchema).max(4096),
    scan_time: z.iso.datetime({ offset: true }),
    // Hasta 3 candidatos de SO que reportó nmap, orden descendente por accuracy. os_candidates[0]
    // == os cuando ambos están presentes.
    os_candidates: z.array(OperatingSystemSchema).max(3),
    // Por qué nmap considera "up" al host (ej. "arp-response", "echo-reply"), no solo el estado.
    state_reason: z.string().max(120),
    // Salida de scripts NSE a nivel host (ej. smb-os-discovery): id de script -> output crudo.
    host_scripts: z.record(z.string().max(120), z.string().max(4000)),
    names: z.array(NameEvidenceSchema).max(20),
    mac_metadata: MacMetadataSchema,
    asset_coverage: AssetCoverageSchema,
    scan_issues: z.array(ScanIssueSchema).max(20),
  })
  .strict()
  .superRefine((asset, ctx) => {
    const kindNeedsMac = [
      'globally_administered',
      'locally_administered',
      'multicast',
      'broadcast',
    ].includes(asset.mac_metadata.kind)
    if (kindNeedsMac && !asset.mac) {
      ctx.addIssue({
        code: 'custom',
        path: ['mac_metadata', 'kind'],
        message: 'classified MAC metadata requires a valid MAC value',
      })
    }
    if (asset.mac_metadata.vendor_resolution === 'resolved' && !asset.vendor) {
      ctx.addIssue({
        code: 'custom',
        path: ['mac_metadata', 'vendor_resolution'],
        message: 'resolved vendor metadata requires a vendor value',
      })
    }
  })

export type AssetPayload = z.infer<typeof AssetPayloadSchema>
