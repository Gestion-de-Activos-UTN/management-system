import { httpClient } from '@/lib/http-client';
import type { Organization } from '@/app/types/payload-types';

type ListResponse<T> = { docs: T[] };

export function listOrganizations(params?: { asOrganization?: string }) {
  return httpClient
    .get<ListResponse<Organization>>('/api/organizations', {
      depth: '1',
      asOrganization: params?.asOrganization,
    })
    .then((r) => r.docs);
}
