import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'

export const syncOrgAdminMemberships: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  const roles = await req.payload.find({
    collection: 'roles',
    where: { slug: { equals: 'org_admin' } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const role = roles.docs[0]
  if (!role) return doc

  const memberships = await req.payload.find({
    collection: 'organization-memberships',
    where: {
      and: [
        { organization: { equals: relationId(doc.organization) } },
        { role: { equals: role.id } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1000,
  })

  for (const membership of memberships.docs) {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {membership, offices}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await req.payload.update({
      collection: 'organization-memberships',
      id: membership.id,
      data: { offices: [...(membership.offices ?? []).map(relationId), doc.id] },
      overrideAccess: true,
      req,
    })
  }

  return doc
}
