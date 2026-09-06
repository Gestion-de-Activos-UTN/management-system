import { z } from 'zod'
import { AssetPayloadSchema, CoverageStatusSchema, ScanIssueSchema } from './asset.schema'

export const ScannerInterfaceSchema = z
  .object({
    name: z.string().min(1).max(120),
    ip: z.ipv4(),
    mac: z.union([z.literal(''), z.string().regex(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/)]),
    network: z.string().min(1).max(43),
    is_route_to_target: z.boolean(),
  })
  .strict()

const TechniqueCoverageSchema = z
  .object({
    status: CoverageStatusSchema,
  })
  .strict()

const MethodCoverageSchema = z
  .object({
    status: CoverageStatusSchema,
    methods_attempted: z.array(z.string().min(1).max(40)).max(12),
  })
  .strict()

const PortCoverageSchema = z
  .object({
    protocol: z.enum(['tcp', 'udp', 'sctp', 'ip']),
    port_spec: z.string().min(1).max(500),
    status: CoverageStatusSchema,
  })
  .strict()

export const ReportCoverageSchema = z
  .object({
    schema_version: z.literal(1),
    profile: z.literal('siam_standard_v1'),
    discovery: MethodCoverageSchema,
    ports: z.array(PortCoverageSchema).max(8),
    service_detection: TechniqueCoverageSchema,
    os_detection: TechniqueCoverageSchema,
    name_resolution: MethodCoverageSchema,
    limitations: z.array(ScanIssueSchema).max(30),
  })
  .strict()

// Mapeo 1:1 contra scanner-prototype/src/siam_agent/models.py::ScanReport.
export const ScanReportPayloadSchema = z
  .object({
    report_id: z.string().min(1).max(120),
    agent_id: z.string().min(1).max(120),
    network: z.string().min(1).max(43),
    scan_start: z.iso.datetime({ offset: true }),
    scan_end: z.iso.datetime({ offset: true }),
    hosts_up: z.number().int().min(0).max(65534),
    assets: z.array(AssetPayloadSchema).max(65534),
    // Resumen derivado de report_coverage. La cobertura detallada es la fuente autoritativa.
    scan_mode: z.enum(['full', 'degraded']),
    scan_mode_reason: z.string().max(500).nullable(),
    execution_status: z.enum(['completed', 'partial', 'failed']),
    scanner_interfaces: z.array(ScannerInterfaceSchema).max(16),
    report_coverage: ReportCoverageSchema,
    // Gateway de la ruta efectiva al target, no necesariamente el gateway por defecto.
    gateway_ip: z.ipv4().nullable(),
    gateway_mac: z.union([z.string().regex(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/), z.null()]),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.hosts_up !== report.assets.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['hosts_up'],
        message: 'hosts_up must match assets.length',
      })
    }
    if (report.scan_mode === 'full' && report.scan_mode_reason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['scan_mode_reason'],
        message: 'full scan mode cannot include a degradation reason',
      })
    }
    if (report.scan_mode === 'degraded' && !report.scan_mode_reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['scan_mode_reason'],
        message: 'degraded scan mode requires a reason',
      })
    }
    if (
      report.scan_mode === 'degraded' &&
      report.report_coverage.os_detection.status === 'complete'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['report_coverage', 'os_detection', 'status'],
        message: 'degraded scan mode cannot claim complete OS detection',
      })
    }
    const globalPortComplete =
      report.report_coverage.ports.length > 0 &&
      report.report_coverage.ports.every(port => port.status === 'complete')
    for (const [index, asset] of report.assets.entries()) {
      if (asset.asset_coverage.port_scan === 'complete' && !globalPortComplete) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index, 'asset_coverage', 'port_scan'],
          message: 'asset port coverage cannot exceed report port coverage',
        })
      }
      for (const field of ['service_detection', 'os_detection', 'name_resolution'] as const) {
        if (
          asset.asset_coverage[field] === 'complete' &&
          report.report_coverage[field].status !== 'complete'
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['assets', index, 'asset_coverage', field],
            message: `asset ${field} coverage cannot exceed report coverage`,
          })
        }
      }
    }
  })

export type ScanReportPayload = z.infer<typeof ScanReportPayloadSchema>
