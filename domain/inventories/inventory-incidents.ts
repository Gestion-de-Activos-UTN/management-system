import type { Payload, PayloadRequest } from 'payload'
import { createHash } from 'node:crypto'

type Incident = { organization: string; office: string; proposed_office?: string; asset?: string; agent?: string; kind: 'identity' | 'location'; reason: string; ip: string; report_id: string; observed_at: string }

/** Stable key updates evidence without duplicating a pending exception on every scan. */
export async function recordInventoryIncident(payload: Payload, data: Incident, req?: PayloadRequest) {
  const key = createHash('sha256').update([data.organization, data.kind, data.asset ?? `${data.office}:${data.ip}`].join('|')).digest('hex')
  const existing = await payload.find({ collection: 'inventory-incidents', req, overrideAccess: true, depth: 0, limit: 1, where: { incident_key: { equals: key } } })
  const current = existing.docs[0]
  // An explicit decision to retain a location applies to repeated observations of that location.
  if (current && Date.parse(current.observed_at) > Date.parse(data.observed_at)) return current
  if (current?.status === 'kept' && String(typeof current.proposed_office === 'object' ? current.proposed_office?.id : current.proposed_office) === data.proposed_office) return current
  const newData = { ...data, incident_key: key, status: 'pending' as const }
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {inventory conflict}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {responsible inventory managers}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  return current ? payload.update({ collection: 'inventory-incidents', id: current.id, req, overrideAccess: true, data: newData }) : payload.create({ collection: 'inventory-incidents', req, overrideAccess: true, data: newData })
}
