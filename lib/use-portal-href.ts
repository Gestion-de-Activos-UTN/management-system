'use client'

import { useSearchParams } from 'next/navigation'
import { portalHref } from './portal-href'

// Para componentes que arman links del portal sin recibir asOrganization por props
// (celdas de tabla, alertas): lo toma de la URL actual.
export function usePortalHref() {
  const asOrganization = useSearchParams().get('asOrganization')
  return (path: string, extra?: string) => portalHref(path, asOrganization, extra)
}
