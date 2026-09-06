import type { Payload } from 'payload'

export interface ExpireRawScanPayloadsResult {
  expired: number
}

export async function expireRawScanPayloads(
  payload: Payload,
  now = new Date()
): Promise<ExpireRawScanPayloadsResult> {
  let expired = 0

  while (true) {
    const reports = await payload.find({
      collection: 'scan-reports',
      where: { raw_payload_expires_at: { less_than_equal: now.toISOString() } },
      overrideAccess: true,
      depth: 0,
      limit: 100,
    })
    if (reports.docs.length === 0) break

    for (const report of reports.docs) {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {report_id, raw_payload_expired_at}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await payload.update({
        collection: 'scan-reports',
        id: report.id,
        overrideAccess: true,
        context: { systemJob: true },
        data: { raw_payload: null, raw_payload_expires_at: null },
      })
      expired += 1
    }
  }

  return { expired }
}
