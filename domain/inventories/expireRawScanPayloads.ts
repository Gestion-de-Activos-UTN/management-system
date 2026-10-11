import { createLocalReq, type Payload } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  RAW_TECHNICAL_RETENTION_DAYS,
  observationExpired,
  expireSnapshotTechnicalEvidence,
} from './technical-evidence'
import { lockAssetRow, withTransaction } from '@/domain/with-transaction'

export interface ExpireRawScanPayloadsResult {
  expired: number
  asset_evidence_expired: number
  snapshot_evidence_expired: number
}

// Only copies that still hold raw evidence: already redacted history is never re-read.
async function candidateIds(
  payload: Payload,
  collection: 'assets' | 'inventory-snapshots',
  cutoff: number
): Promise<string[]> {
  if (collection === 'assets') {
    const result = await payload.find({
      collection,
      where: {
        and: [
          {
            or: [
              { last_seen: { less_than_equal: new Date(cutoff).toISOString() } },
              { last_seen: { exists: false } },
            ],
          },
          { or: [{ host_scripts: { exists: true } }, { 'services.scripts': { exists: true } }] },
        ],
      },
      overrideAccess: true,
      depth: 0,
      pagination: false,
      sort: 'id',
      select: {},
    })
    return result.docs.map(doc => String(doc.id))
  }
  // assets_dump is one JSON blob that Payload cannot filter by key; redaction removes the
  // host_scripts/scripts keys, so a dump without them has nothing left to expire.
  const result = await (payload.db.drizzle as PostgresAdapter['drizzle']).execute(
    sql`SELECT id FROM inventory_snapshots WHERE assets_dump::text LIKE '%scripts"%' ORDER BY id`
  )
  return result.rows.map(row => String((row as { id: unknown }).id))
}

async function expireCopies(
  payload: Payload,
  collection: 'assets' | 'inventory-snapshots',
  cutoff: number
) {
  let expired = 0
  for (const id of await candidateIds(payload, collection, cutoff)) {
    const request = await createLocalReq({ context: { systemJob: true } }, payload)
    const changed = await withTransaction(payload, request, async req => {
      // Coordinate with ingestion's row update; re-read after waiting so new evidence survives.
      await lockAssetRow(req, collection, id)
      let data: Record<string, unknown> | undefined
      if (collection === 'assets') {
        const current = await payload.findByID({ collection: 'assets', id, overrideAccess: true, depth: 0, req })
        if (
          observationExpired(current.last_seen, cutoff) &&
          (current.host_scripts != null || current.services?.some(service => service.scripts != null))
        )
          data = {
            host_scripts: null,
            // Payload merges existing array rows; omission preserves the old JSON value.
            ...(current.services
              ? { services: current.services.map(service => ({ ...service, scripts: null })) }
              : {}),
          }
      } else {
        const current = await payload.findByID({ collection: 'inventory-snapshots', id, overrideAccess: true, depth: 0, req })
        const clean = expireSnapshotTechnicalEvidence(current.assets_dump, cutoff)
        if (JSON.stringify(current.assets_dump) !== JSON.stringify(clean)) data = { assets_dump: clean }
      }
      if (!data) return false
      // AUDIT: this action must emit an AuditLogs entry (raw evidence expiry; normalized inventory and historical score retained)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await payload.update({ collection, id, overrideAccess: true, req, data })
      return true
    })
    if (changed) expired++
  }
  return expired
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

  const cutoff = now.getTime() - RAW_TECHNICAL_RETENTION_DAYS * 86400000
  const asset_evidence_expired = await expireCopies(payload, 'assets', cutoff)
  const snapshot_evidence_expired = await expireCopies(payload, 'inventory-snapshots', cutoff)
  return { expired, asset_evidence_expired, snapshot_evidence_expired }
}
