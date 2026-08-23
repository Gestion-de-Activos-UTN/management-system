'use client';

import { useUiStore } from '@/lib/ui-store';
import { useListQuery } from '@/lib/use-list-query';
import { listSnapshots } from '../service';

export function useSnapshotsList(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  return useListQuery(
    'inventory-snapshots',
    () => listSnapshots({ asOrganization, officeId: selectedOfficeId }),
    [asOrganization, selectedOfficeId],
  );
}
