import type { ScanReportPayload } from '@/contracts/scan-report.schema'
import type { AssetPayload } from '@/contracts/asset.schema'
import type { AgentAuthResult } from '@/access/middleware/resolveAgentAuth'

// Corroboration fixtures, not demo seed or production contract generators.
export function auditAsset(
  auth: AgentAuthResult,
  overrides: Partial<AssetPayload> = {}
): AssetPayload {
  return {
    asset_id: `audit-${crypto.randomUUID()}`,
    agent_id: auth.agentId,
    ip: '10.0.0.90',
    mac: '',
    vendor: '',
    hostname: '',
    os: null,
    services: [],
    scan_time: new Date().toISOString(),
    os_candidates: [],
    state_reason: '',
    host_scripts: {},
    names: [],
    mac_metadata: { kind: 'unknown', vendor_resolution: 'unknown' },
    asset_coverage: {
      port_scan: 'complete',
      service_detection: 'complete',
      os_detection: 'not_attempted',
      name_resolution: 'complete',
    },
    scan_issues: [],
    ...overrides,
  }
}

export function auditReport(
  auth: AgentAuthResult,
  assets: AssetPayload[],
  overrides: Partial<ScanReportPayload> = {}
): ScanReportPayload {
  const now = new Date().toISOString()
  return {
    report_id: `audit-${crypto.randomUUID()}`,
    agent_id: auth.agentId,
    network: '10.0.0.0/24',
    scan_start: now,
    scan_end: now,
    hosts_up: assets.length,
    assets,
    scan_mode: 'full',
    scan_mode_reason: null,
    execution_status: 'completed',
    scanner_interfaces: [],
    report_coverage: {
      schema_version: 1,
      profile: 'siam_standard_v1',
      discovery: { status: 'complete', methods_attempted: ['arp'] },
      ports: [{ protocol: 'tcp', port_spec: '1-1000', status: 'complete' }],
      service_detection: { status: 'complete' },
      os_detection: { status: 'not_attempted' },
      name_resolution: { status: 'complete', methods_attempted: ['ptr'] },
      limitations: [],
    },
    gateway_ip: null,
    gateway_mac: null,
    ...overrides,
  }
}
