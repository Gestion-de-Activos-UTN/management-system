'use client';

import { useQuery } from '@tanstack/react-query';
import { getScanReport } from '../service';

export function useScanReport(id: string) {
  return useQuery({ queryKey: ['scan-reports', id], queryFn: () => getScanReport(id), enabled: !!id });
}
