import type { PayloadRequest } from 'payload'
import {
  OrganizationDetailsSchema,
  type OrganizationDetailsInput,
} from '@/modules/organizations/schema'
import { AdminDomainError, assertOrganizationActive } from './admin-actions'

/** Runs inside the caller's organization lock and transaction. */
export async function updateOrganizationDetails(
  req: PayloadRequest,
  organizationId: string,
  input: OrganizationDetailsInput
) {
  const data = OrganizationDetailsSchema.parse(input)
  await assertOrganizationActive(req, organizationId)
  const settings = await req.payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: organizationId } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (!settings.docs[0])
    throw new AdminDomainError(
      'organization_settings_missing',
      409,
      'La organización no tiene configuración disponible.'
    )

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organizationId, name}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for the organization's administrators
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'organizations',
    id: organizationId,
    overrideAccess: true,
    req,
    data: { name: data.name },
  })
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organizationId, industry, industry_details}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for the organization's administrators
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  await req.payload.update({
    collection: 'organization-settings',
    id: settings.docs[0].id,
    overrideAccess: true,
    req,
    data: { industry: data.industry, industry_details: data.industry_details || null },
  })
}
