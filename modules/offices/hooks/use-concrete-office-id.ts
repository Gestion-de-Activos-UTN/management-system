'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { officeRiskScope } from '../office-risk-scope'
import { useUiStore } from '@/lib/ui-store'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

/** Resuelve el alcance del riesgo sin reemplazar el filtro global «Todas las oficinas». */
export function useConcreteOfficeId(asOrganization?: string) {
  const linkedOfficeId = useSearchParams().get('officeId')
  const tenant = useTenantContext(asOrganization).data
  const selectedOfficeId = useUiStore(state => state.selectedOfficeId)
  const setSelectedOfficeId = useUiStore(state => state.setSelectedOfficeId)

  const linkedAllowed = Boolean(
    tenant &&
    linkedOfficeId &&
    (linkedOfficeId === 'all'
      ? tenant.orgWide
      : tenant.orgWide || tenant.officeIds.includes(linkedOfficeId))
  )
  useEffect(() => {
    if (linkedAllowed) setSelectedOfficeId(linkedOfficeId === 'all' ? null : linkedOfficeId)
  }, [linkedOfficeId, linkedAllowed, setSelectedOfficeId])

  return officeRiskScope(tenant, selectedOfficeId)
}
