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
  })
  .passthrough()

export type ScanReportPayload = z.infer<typeof ScanReportPayloadSchema>
