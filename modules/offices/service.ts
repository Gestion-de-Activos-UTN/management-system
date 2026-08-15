import { httpClient } from '@/lib/http-client';
import type { Office } from '@/app/types/payload-types';

type ListResponse<T> = { docs: T[] };

export function listOffices(params?: { asOrganization?: string }) {
  return httpClient
    .get<ListResponse<Office>>('/api/offices', {
      depth: '1',
      asOrganization: params?.asOrganization,
    })
    .then((r) => r.docs);
}
