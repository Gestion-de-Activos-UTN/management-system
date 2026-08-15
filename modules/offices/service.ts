import { listResource } from '@/lib/list-resource';
import type { Office } from '@/app/types/payload-types';

export function listOffices(params?: { asOrganization?: string }) {
  return listResource<Office>('/api/offices', { depth: '1', asOrganization: params?.asOrganization });
}
