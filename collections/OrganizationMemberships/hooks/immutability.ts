import type { CollectionBeforeValidateHook } from 'payload'

// organization/user inmutables tras creación — mismo patrón que Agents.office.
export const enforceImmutableOrgAndUser: CollectionBeforeValidateHook = ({ data, operation, originalDoc }) => {
  if (operation !== 'update' || !originalDoc) return data
  const patch = data ?? {}
  for (const field of ['organization', 'user'] as const) {
    if (field in patch && String(patch[field]) !== String(originalDoc[field])) {
      throw new Error(`OrganizationMemberships.${field} es inmutable después de la creación`)
    }
  }
  return data
}
