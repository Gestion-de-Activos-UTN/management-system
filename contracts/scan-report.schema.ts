import { z } from 'zod'
import { AssetPayloadSchema } from './asset.schema'

// Mapeo 1:1 contra scanner-prototype/src/siam_agent/models.py::ScanReport.
export const ScanReportPayloadSchema = z
  .object({
    report_id: z.string(),
    agent_id: z.string(),
    network: z.string(),
    scan_start: z.string(),
    scan_end: z.string(),
    hosts_up: z.number().int(),
    assets: z.array(AssetPayloadSchema),
    // Agente degrada a TCP-connect no privilegiado si falta root/Administrator o el driver
    // Npcap (Windows) para ARP/SYN raw. Default cubre reportes de agentes viejos que no
    // mandan el campo (siempre corrieron con capacidades plenas o el dato simplemente no existía).
    scan_mode: z.enum(['full', 'degraded']).default('full'),
    scan_mode_reason: z.string().nullable().default(null),
    // Gateway de la red escaneada (IP+MAC), resuelto por el agente desde su propia tabla de
    // ruteo/ARP — no es un guess por vendor/hostname (ver inferDeviceCategory.ts, que es otra
    // cosa): todo asset de este mismo reporte está, por construcción del scan, detrás de este
    // gateway. Nullable/default null: puede no resolverse (permiso denegado, host sin ruta
    // default) y agentes viejos no lo mandan.
    gateway_ip: z.string().nullable().default(null),
    gateway_mac: z.string().nullable().default(null),
  })
  .passthrough()

export type ScanReportPayload = z.infer<typeof ScanReportPayloadSchema>
