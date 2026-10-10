import { createLocalReq, type Payload, type Where } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  RAW_TECHNICAL_RETENTION_DAYS,
  observationExpired,
  expireSnapshotTechnicalEvidence,
} from './technical-evidence'

export interface ExpireRawScanPayloadsResult {
  expired: number
  asset_evidence_expired: number
  snapshot_evidence_expired: number
}

async function expireCopies(
  payload: Payload,
  collection: 'assets' | 'inventory-snapshots',
  cutoff: number
) {
  let afterId: string | undefined,
    expired = 0
  while (true) {
    const filters: Where[] = []
    if (collection === 'assets')
      filters.push({
        or: [
          { last_seen: { less_than_equal: new Date(cutoff).toISOString() } },
          { last_seen: { exists: false } },
        ],
      })
    if (afterId) filters.push({ id: { greater_than: afterId } })
    const batch = await payload.find({
      collection,
      where: filters.length ? { and: filters } : undefined,
      overrideAccess: true,
      depth: 0,
      limit: 100,
      sort: 'id',
    })
    if (!batch.docs.length) break
    for (const candidate of batch.docs) {
      const req = await createLocalReq({ context: { systemJob: true } }, payload)
      const transactionID = await payload.db.beginTransaction()
      if (!transactionID) throw new Error('Evidence retention requires transactions')
      req.transactionID = transactionID
      try {
        const session = payload.db.sessions?.[transactionID]
        if (!session) throw new Error('Evidence retention transaction is not active')
        const transaction = session.db as PostgresAdapter['drizzle']
        // Coordinate with ingestion's row update; re-read after waiting so new evidence survives.
        const table = collection === 'assets' ? 'assets' : 'inventory_snapshots'
        await transaction.execute(
          sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${candidate.id} FOR UPDATE`
        )
        let data: Record<string, unknown> | undefined
        if (collection === 'assets') {
          const current = await payload.findByID({
            collection: 'assets',
            id: candidate.id,
            overrideAccess: true,
            depth: 0,
            req,
          })
          if (observationExpired(current.last_seen, cutoff)) {
            if (
              current.host_scripts != null ||
              current.services?.some(service => service.scripts != null)
            )
              data = {
                host_scripts: null,
                // Payload merges existing array rows; omission preserves the old JSON value.
                ...(current.services
                  ? { services: current.services.map(service => ({ ...service, scripts: null })) }
                  : {}),
              }
          }
        } else {
          const current = await payload.findByID({
            collection: 'inventory-snapshots',
            id: candidate.id,
            overrideAccess: true,
            depth: 0,
            req,
          })
          const clean = expireSnapshotTechnicalEvidence(current.assets_dump, cutoff)
          if (JSON.stringify(current.assets_dump) !== JSON.stringify(clean))
            data = { assets_dump: clean }
        }
        if (data) {
          // AUDIT: this action must emit an AuditLogs entry (raw evidence expiry; normalized inventory and historical score retained)
          // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
          await payload.update({ collection, id: candidate.id, overrideAccess: true, req, data })
          expired++
        }
        await payload.db.commitTransaction(transactionID)
      } catch (error) {
        await payload.db.rollbackTransaction(transactionID)
        throw error
      }
    }
    afterId = String(batch.docs[batch.docs.length - 1].id)
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
