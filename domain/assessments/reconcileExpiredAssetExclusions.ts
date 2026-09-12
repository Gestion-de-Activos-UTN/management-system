import type { Payload } from 'payload'

export type ExpiredAssetExclusionSummary = {
  network_assets_reincluded: number
  manual_assets_reincluded: number
}

export async function reconcileExpiredAssetExclusions(
  payload: Payload,
  now = new Date()
): Promise<ExpiredAssetExclusionSummary> {
  const summary = { network_assets_reincluded: 0, manual_assets_reincluded: 0 }
  const expiration = now.toISOString()
  for (const collection of ['assets', 'non-network-assets'] as const) {
    const result = await payload.find({
      collection,
      where: {
        and: [
          { assessment_scope: { equals: 'excluded' } },
          { assessment_excluded_until: { less_than_equal: expiration } },
        ],
      },
      overrideAccess: true,
      depth: 0,
      limit: 5000,
    })
    for (const asset of result.docs) {
      // AUDIT: this action must emit an AuditLogs entry (chain_hash over {asset, assessment_scope: included, reason: exclusion_expired}, previous hash for this organization_id)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      // NOTIFY: this event should trigger a Notification Bell entry for {asset owner and responsible office roles}
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await payload.update({
        collection,
        id: asset.id,
        overrideAccess: true,
        data: { assessment_scope: 'included' },
      })
      if (collection === 'assets') summary.network_assets_reincluded += 1
      else summary.manual_assets_reincluded += 1
    }
  }
  return summary
}
