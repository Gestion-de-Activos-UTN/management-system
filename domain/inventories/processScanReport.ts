import type { Payload, PayloadRequest } from 'payload'
import type { AgentAuthResult } from '@/access/middleware/resolveAgentAuth'
import type { ScanReportPayload } from '@/contracts/scan-report.schema'
import { reevaluateComplianceAfterScan } from '@/domain/assessments/evaluateAutomaticCompliance'
import { ingestScanReport, type IngestResult } from './ingestScanReport'
import { maybeCreateAutoSnapshot } from './autoSnapshot'

const RAW_PAYLOAD_RETENTION_DAYS = 30

export interface ProcessScanReportResult extends IngestResult {
  reportId: string
  status: 'processed' | 'failed'
  alreadyProcessed: boolean
}

/**
 * Persists and processes one already authenticated, contract-valid scanner report.
 * Both the HTTP endpoint and local demo seed use this function so derived inventory,
 * compliance, snapshots and retry semantics cannot drift between the two entry points.
 */
export async function processScanReport(
  payload: Payload,
  body: ScanReportPayload,
  auth: AgentAuthResult,
  req?: PayloadRequest
): Promise<ProcessScanReportResult> {
  const existing = await payload.find({
    collection: 'scan-reports',
    where: { id: { equals: body.report_id } },
    overrideAccess: true,
    limit: 1,
    depth: 0,
  })
  const existingReport = existing.docs[0]

  if (existingReport && existingReport.status !== 'received') {
    return {
      reportId: body.report_id,
      status: existingReport.status === 'failed' ? 'failed' : 'processed',
      alreadyProcessed: true,
      processedAssetIds: [],
      processedDocumentIds: [],
      rejectedAssets: [],
    }
  }

  if (!existingReport) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {report, agent, office}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.create({
      collection: 'scan-reports',
      overrideAccess: true,
      data: {
        id: body.report_id,
        agent: auth.agentId,
        office: auth.officeId,
        network: body.network,
        scan_start: body.scan_start,
        scan_end: body.scan_end,
        hosts_up: body.hosts_up,
        execution_status: body.execution_status,
        report_coverage: body.report_coverage,
        scanner_interfaces: body.scanner_interfaces,
        gateway_ip: body.gateway_ip,
        gateway_mac: body.gateway_mac,
        raw_payload: body,
        raw_payload_expires_at: new Date(
          Date.now() + RAW_PAYLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000
        ).toISOString(),
        status: 'received',
      },
    })
  }

  // The snapshot intentionally represents the state immediately before applying this scan.
  try {
    await maybeCreateAutoSnapshot(payload, auth.officeId, auth.organizationId)
  } catch {
    // Snapshot creation is secondary and must never make the scanner retry a valid report.
  }

  const result = await ingestScanReport(payload, body, auth)
  await reevaluateComplianceAfterScan(
    payload,
    auth.organizationId,
    auth.officeId,
    result.processedDocumentIds,
    req,
    new Date(body.scan_end)
  )

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {report, status, rejected assets}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await payload.update({
    collection: 'scan-reports',
    id: body.report_id,
    overrideAccess: true,
    data: {
      status: 'processed',
      processed_at: new Date().toISOString(),
      error: result.rejectedAssets.length > 0 ? JSON.stringify(result.rejectedAssets) : null,
    },
  })

  return {
    ...result,
    reportId: body.report_id,
    status: 'processed',
    alreadyProcessed: false,
  }
}
