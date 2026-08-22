'use client';

import { useUiStore } from '@/lib/ui-store';
import { useListQuery } from '@/lib/use-list-query';
import { listScanReports } from '../service';

export function useScanReportsList(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  return useListQuery(
    'scan-reports',
    () => listScanReports({ asOrganization, officeId: selectedOfficeId }),
    [asOrganization, selectedOfficeId],
  );
}
