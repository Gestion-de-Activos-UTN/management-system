'use client';

import { useUiStore } from '@/lib/ui-store';
import { useListQuery } from '@/lib/use-list-query';
import { listNonNetworkAssets } from '../service';

export function useNonNetworkAssetsList(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  return useListQuery(
    'non-network-assets',
    () => listNonNetworkAssets({ asOrganization, officeId: selectedOfficeId }),
    [asOrganization, selectedOfficeId],
  );
}
