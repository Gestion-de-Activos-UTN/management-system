import { APIError } from 'payload'

export class OrganizationMismatchError extends APIError {
  constructor(message: string) {
    super(message, 403, undefined, true)
  }
}

// `ctx.officeIds` is already scoped to the actor's own organization by construction
// (resolveTenantContext.ts resolves it from the actor's own active OrganizationMembership, or —
// for a platform_admin visiting via ?asOrganization= — from that org's offices). So checking
// `officeId ∈ ctx.officeIds` (assertOfficeInScope) is *today* equivalent to checking the row's
// organization, but only as long as that invariant holds elsewhere (OrganizationMemberships.offices
// is only ever written by trusted domain code, with no schema-level enforcement that those offices
// belong to the membership's own organization). A sensitive write (creating an audit-relevant
// snapshot, confirming a review) shouldn't have its tenant boundary depend transitively on an
// invariant enforced in a completely different file — verify the row's own organization directly,
// same principle as SYSTEM_PROMPT.md §7 ("row-level tenant scoping ... never skipped").
export function assertOrganizationMatches(
  rowOrganizationId: string,
  actorOrganizationId: string | null,
  unrestricted: boolean
): void {
  if (unrestricted) return
  if (!actorOrganizationId || rowOrganizationId !== actorOrganizationId) {
    throw new OrganizationMismatchError('Este recurso pertenece a otra organización')
  }
}
