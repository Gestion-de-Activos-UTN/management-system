// Un admin de plataforma que "visita" una organización navega el portal con ?asOrganization=;
// cualquier link interno que lo pierda lo expulsa a "/" (ver app/portal/(protected)/layout.tsx).
// Único lugar que arma ese query string — no concatenarlo a mano en cada página.
export function portalHref(path: string, asOrganization?: string | null, extra?: string): string {
  const params = [extra, asOrganization ? `asOrganization=${encodeURIComponent(asOrganization)}` : '']
    .filter(Boolean)
    .join('&')
  if (!params) return path
  return `${path}${path.includes('?') ? '&' : '?'}${params}`
}
