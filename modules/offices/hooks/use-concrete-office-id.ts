'use client'

import { useEffect } from 'react'
import { useUiStore } from '@/lib/ui-store'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

/**
 * Risk evaluations exist per organization or per office, never per set of offices. Office-scoped
 * users (tenant.orgWide = false) therefore always work on one concrete office: when "Todas las
 * oficinas" is selected, the first of theirs is picked in the shared store so the TopBar agrees.
 * `ready` gates the queries until that selection lands, avoiding a guaranteed 403.
 */
export function useConcreteOfficeId(asOrganization?: string) {
  const tenant = useTenantContext(asOrganization).data
  const selectedOfficeId = useUiStore(state => state.selectedOfficeId)
  const setSelectedOfficeId = useUiStore(state => state.setSelectedOfficeId)
  const needsOffice = tenant ? !tenant.orgWide : false
  const fallback = tenant?.officeIds[0] ?? null

  useEffect(() => {
    if (needsOffice && !selectedOfficeId && fallback) setSelectedOfficeId(fallback)
  }, [needsOffice, selectedOfficeId, fallback, setSelectedOfficeId])

  return {
    officeId: selectedOfficeId,
    // Without any office there is nothing to wait for: let the request surface the 403.
    ready: Boolean(tenant) && (!needsOffice || Boolean(selectedOfficeId) || !fallback),
  }
}
