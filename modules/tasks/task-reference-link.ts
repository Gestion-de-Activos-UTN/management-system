import type { TaskReferenceInfo } from './service'

export function getTaskReferenceHref(
  reference: TaskReferenceInfo,
  asOrganization?: string
): string | null {
  if (!reference.available) return null
  const suffix = asOrganization ? `asOrganization=${encodeURIComponent(asOrganization)}` : ''
  const withQuery = (path: string, query?: string) => {
    const params = [query, suffix].filter(Boolean).join('&')
    return params ? `${path}?${params}` : path
  }
  switch (reference.relationTo) {
    case 'offices':
      return withQuery('/portal/inventory', `officeId=${encodeURIComponent(reference.value)}`)
    case 'assets':
      return withQuery(`/portal/inventory/${reference.value}`)
    case 'non-network-assets':
      return withQuery(
        '/portal/inventory',
        `nonNetworkAsset=${encodeURIComponent(reference.value)}`
      )
    case 'assessment-instances':
      return withQuery(`/portal/security-review/${reference.value}`)
    case 'compliance-results':
      return withQuery('/portal/security-review', `result=${encodeURIComponent(reference.value)}`)
    case 'inventory-snapshots':
      return withQuery(`/portal/inventory/snapshots/${reference.value}`)
    case 'scan-reports':
      return withQuery(`/portal/inventory/scan-reports/${reference.value}`)
    case 'risk-evaluations':
      return withQuery(
        '/portal/risk-score',
        `evaluation=${encodeURIComponent(reference.value)}&officeId=${encodeURIComponent(reference.office_id ?? 'all')}`
      )
    case 'agents':
      return withQuery(
        '/portal/administration/offices',
        `agent=${encodeURIComponent(reference.value)}`
      )
  }
}

/** Open the live scope while keeping the immutable reference as evidence. */
export function getTaskCurrentReferenceHref(
  reference: TaskReferenceInfo,
  asOrganization?: string
): string | null {
  if (
    !reference.available ||
    !['inventory-snapshots', 'risk-evaluations'].includes(reference.relationTo)
  )
    return null
  const params = new URLSearchParams({ officeId: reference.office_id ?? 'all' })
  if (asOrganization) params.set('asOrganization', asOrganization)
  return `${reference.relationTo === 'inventory-snapshots' ? '/portal/inventory' : '/portal/risk-score'}?${params}`
}
