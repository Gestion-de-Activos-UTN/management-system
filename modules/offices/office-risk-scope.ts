/** A multi-office filter is valid for lists, but is not a stored risk evaluation. */
export function officeRiskScope(
  tenant:
    | { orgWide: boolean; officeIds: string[]; permissions?: { assignedOfficeRisk?: boolean } }
    | null
    | undefined,
  selectedOfficeId: string | null
) {
  const officeId = tenant?.officeIds.includes(selectedOfficeId ?? '')
    ? selectedOfficeId
    : selectedOfficeId === null && tenant?.officeIds.length === 1
      ? tenant.officeIds[0]
      : null
  const requiresOfficeSelection = Boolean(
    tenant &&
    !tenant.orgWide &&
    !tenant.permissions?.assignedOfficeRisk &&
    !officeId &&
    tenant.officeIds.length > 1
  )
  return {
    officeId,
    requiresOfficeSelection,
    ready:
      Boolean(tenant) &&
      !requiresOfficeSelection &&
      (selectedOfficeId === null || officeId !== null),
  }
}
