'use client';

import { useUiStore } from '@/lib/ui-store';
import { useListQuery } from '@/lib/use-list-query';
import { listSnapshots } from '../service';

// Usado por app/portal/(protected)/risk-score/page.tsx para reemplazar el FAKE_SCORE — trae el
// snapshot más reciente de la oficina seleccionada (o de toda la org si no hay oficina elegida)
// y se queda solo con el primero (listSnapshots ya ordena por taken_at desc).
export function useLatestSnapshot(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  const query = useListQuery(
    'inventory-snapshots',
    () => listSnapshots({ asOrganization, officeId: selectedOfficeId }),
    [asOrganization, selectedOfficeId],
  );
  return { ...query, data: query.data?.[0] ?? null };
}
