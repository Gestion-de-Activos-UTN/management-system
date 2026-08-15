'use client';

import { useListQuery } from '@/lib/use-list-query';
import { listOffices } from '../service';

export function useOfficesList(asOrganization?: string) {
  return useListQuery('offices', () => listOffices({ asOrganization }), [asOrganization]);
}
