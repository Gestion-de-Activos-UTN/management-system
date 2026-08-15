import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from './relationId'

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
