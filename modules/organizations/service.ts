import { listResource } from '@/lib/list-resource';
import type { Organization } from '@/app/types/payload-types';

export function listOrganizations(params?: { asOrganization?: string }) {
  return listResource<Organization>('/api/organizations', { depth: '1', asOrganization: params?.asOrganization });
}
