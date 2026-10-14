/** Forward the explicitly selected organization from the portal URL, including mutations. */
export function organizationRequestPath(path: string, portalSearch: string): string {
  if (!path.startsWith('/api/')) return path
  const organization = new URLSearchParams(portalSearch).get('asOrganization')
  if (!organization) return path
  const url = new URL(path, 'http://localhost')
  if (!url.searchParams.has('asOrganization')) url.searchParams.set('asOrganization', organization)
  return `${url.pathname}${url.search}`
}
