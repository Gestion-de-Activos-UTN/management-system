'use client';

import { useQuery } from '@tanstack/react-query';
import { listOffices } from '../service';

export function useOfficesList(asOrganization?: string) {
  return useQuery({
    queryKey: ['offices', asOrganization],
    queryFn: () => listOffices({ asOrganization }),
  });
}
