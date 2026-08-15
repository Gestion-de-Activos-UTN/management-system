'use client';

import { useListQuery } from '@/lib/use-list-query';
import { listOrganizations } from '../service';

export function useOrganizationsList(asOrganization?: string) {
  return useListQuery('organizations', () => listOrganizations({ asOrganization }), [asOrganization]);
}
