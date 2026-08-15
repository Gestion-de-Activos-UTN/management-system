'use client';

import { useQuery } from '@tanstack/react-query';
import { listOrganizations } from '../service';

export function useOrganizationsList(asOrganization?: string) {
  return useQuery({
    queryKey: ['organizations', asOrganization],
    queryFn: () => listOrganizations({ asOrganization }),
  });
}
