'use client';

import { useListQuery } from '@/lib/use-list-query';
import { getOrganizationSettings } from '../service';

export function useOrganizationSettings() {
  return useListQuery('organization-settings', () => getOrganizationSettings());
}
