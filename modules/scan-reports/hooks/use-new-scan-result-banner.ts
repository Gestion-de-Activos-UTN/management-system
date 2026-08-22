'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUiStore } from '@/lib/ui-store';
import { getLatestProcessedScanReport } from '../service';

// ponytail: primer polling del repo (nada más lo usa) — solo esta key liviana (limit=1), nunca
// invalida ['assets']/['non-network-assets'] por sí sola. Un ingest en curso puede llegar en
// cualquier momento, incluso mientras el usuario está a mitad de completar el form de alta
// manual de un asset (app/portal/(protected)/inventory/page.tsx) — refrescar esas listas solo
// porque el poll vio un id nuevo le pisaría el formulario sin avisar. Este hook solo decide SI
// hay algo nuevo; quien lo consume (el banner) es el único que dispara el refetch, y solo cuando
// el usuario lo pide con un click.
export function useNewScanResultBanner(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  const { data: latest } = useQuery({
    queryKey: ['scan-reports', 'latest-processed', asOrganization, selectedOfficeId],
    queryFn: () => getLatestProcessedScanReport({ asOrganization, officeId: selectedOfficeId }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // El primer resultado visto es la línea de base ("esto es lo que ya está en pantalla"), no una
  // novedad — solo un cambio respecto a esa base cuenta como "nuevo resultado".
  const [acknowledgedId, setAcknowledgedId] = useState<string | null>(null);
  const [hasBaseline, setHasBaseline] = useState(false);

  useEffect(() => {
    if (latest && !hasBaseline) {
      setAcknowledgedId(latest.id);
      setHasBaseline(true);
    }
  }, [latest, hasBaseline]);

  const hasNewResult = hasBaseline && latest != null && latest.id !== acknowledgedId;

  return {
    hasNewResult,
    acknowledge: () => {
      if (latest) setAcknowledgedId(latest.id);
    },
  };
}
