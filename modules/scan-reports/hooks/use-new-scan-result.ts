'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ScanReport } from '@/app/types/payload-types'
import { getLatestProcessedScanReport } from '../service'

// Monitor organizacional liviano: consulta una sola fila procesada y vive en el layout del portal,
// no en Inventory. El mapa conserva una línea de base independiente por organización para que un
// platform admin no reciba un falso positivo al cambiar ?asOrganization=.
export function useNewScanResult(scopeKey: string, asOrganization?: string) {
  const { data: latest } = useQuery({
    queryKey: ['scan-reports', 'latest-processed', scopeKey],
    queryFn: () => getLatestProcessedScanReport({ asOrganization }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  })

  const latestByScope = useRef(new Map<string, string>())
  const [newResult, setNewResult] = useState<{ scopeKey: string; report: ScanReport } | null>(null)

  useEffect(() => {
    if (!latest) return
    const latestId = String(latest.id)
    const baselineId = latestByScope.current.get(scopeKey)
    latestByScope.current.set(scopeKey, latestId)
    if (baselineId !== undefined && baselineId !== latestId) {
      setNewResult({ scopeKey, report: latest })
    }
  }, [latest, scopeKey])

  return newResult?.scopeKey === scopeKey ? newResult.report : null
}
