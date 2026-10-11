import type { Payload, PayloadRequest } from 'payload'
import type { AgentAuthResult } from '@/access/middleware/resolveAgentAuth'
import type { ScanReportPayload } from '@/contracts/scan-report.schema'
import { ScanReportPayloadSchema } from '@/contracts/scan-report.schema'
import { reevaluateComplianceAfterScan } from '@/domain/assessments/evaluateAutomaticCompliance'
import { ingestScanReport, type IngestResult } from './ingestScanReport'
import { maybeCreateAutoSnapshot } from './autoSnapshot'
import { RAW_TECHNICAL_RETENTION_DAYS } from './technical-evidence'
import { createHash } from 'node:crypto'
import { APIError } from 'payload'
import { relationId } from '@/lib/relationId'
import { transactionLock, withTransaction } from '@/domain/with-transaction'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

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
  request?: PayloadRequest
): Promise<ProcessScanReportResult> {
  const parsed = ScanReportPayloadSchema.safeParse(body)
  if (!parsed.success) throw new APIError('invalid scan report', 400, parsed.error.issues)
  body = parsed.data
  if (body.agent_id !== auth.agentId || body.assets.some(asset => asset.agent_id !== auth.agentId))
    throw new APIError('agent_id mismatch', 400)
  // Serialize all inventory observations of an organization before identity lookup/upsert.
  return withTransaction(payload, request, async req => {
  await transactionLock(req, `scan-report:${body.report_id}`)
  const fingerprint = createHash('sha256').update(canonical(body)).digest('hex')
  const existing = await payload.find({
    collection: 'scan-reports',
    req,
    where: { id: { equals: body.report_id } },
    overrideAccess: true,
    limit: 1,
    depth: 0,
  })
  const existingReport = existing.docs[0]
  if (existingReport && (relationId(existingReport.agent) !== auth.agentId || existingReport.content_fingerprint !== fingerprint))
    throw new APIError('report_id already belongs to a different agent or payload', 409)

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
      req,
      overrideAccess: true,
      data: {
        id: body.report_id,
        content_fingerprint: fingerprint,
        received_at: new Date().toISOString(),
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
          Date.now() + RAW_TECHNICAL_RETENTION_DAYS * 24 * 60 * 60 * 1000
        ).toISOString(),
        status: 'received',
      },
    })
  }

  // The snapshot intentionally represents the state immediately before applying this scan.
  if (body.execution_status !== 'failed')
    await maybeCreateAutoSnapshot(payload, auth.officeId, auth.organizationId, req)

  const result: IngestResult = body.execution_status === 'failed'
    ? { processedAssetIds: [], processedDocumentIds: [], rejectedAssets: [] }
    : await ingestScanReport(payload, body, auth, req)
  if (body.execution_status !== 'failed')
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
    req,
    id: body.report_id,
    overrideAccess: true,
    data: {
      status: body.execution_status === 'failed' ? 'failed' : 'processed',
      execution_status: body.execution_status === 'completed' && result.rejectedAssets.length ? 'partial' : body.execution_status,
      processed_at: new Date().toISOString(),
      error: result.rejectedAssets.length > 0 ? JSON.stringify(result.rejectedAssets) : null,
    },
  })

  return {
    ...result,
    reportId: body.report_id,
    status: body.execution_status === 'failed' ? 'failed' : 'processed',
    alreadyProcessed: false,
  }
  }, { isolationLevel: 'repeatable read', lockKey: `inventory:${auth.organizationId}` })
}
