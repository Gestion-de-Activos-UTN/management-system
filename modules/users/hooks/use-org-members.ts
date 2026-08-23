'use client';

import { useListQuery } from '@/lib/use-list-query';
import { listOrgMembers } from '../service';

export function useOrgMembers(asOrganization?: string) {
  return useListQuery('org-members', () => listOrgMembers({ asOrganization }), [asOrganization]);
}
