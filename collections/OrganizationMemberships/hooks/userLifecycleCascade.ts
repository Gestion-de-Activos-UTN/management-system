import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'

// create: enlaza Users.organization_membership de vuelta (users.organization_membership es readOnly).
export const linkMembershipToUser: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  await req.payload.update({
    collection: 'users',
    id: relationId(doc.user),
    data: { organization_membership: doc.id },
    overrideAccess: true,
    req,
  })
  return doc
}

// Cascada: is_active true->false desactiva Users.status (ciclo de vida, doc 04 regla 5).
// Reactivar la membership NO revierte esto automáticamente (mismo criterio que
// la desactivación de organización, doc 03 — exige revisión manual explícita).
export const cascadeDeactivationToUser: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  if (previousDoc?.is_active === true && doc.is_active === false) {
    // AUDIT: this action must emit an AuditLogs entry (user.deactivate, cascaded from membership deactivation, chain_hash over {user, organization}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: this event should trigger a Notification Bell entry for {the deactivated user, org_admins of this organization}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    await req.payload.update({
      collection: 'users',
      id: relationId(doc.user),
      data: { status: 'inactive' },
      overrideAccess: true,
      req,
    })
  }
  return doc
}
