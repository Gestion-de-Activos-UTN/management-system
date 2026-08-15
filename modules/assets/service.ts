import { httpClient } from '@/lib/http-client';
import type { Asset } from '@/app/types/payload-types';

type ListResponse<T> = { docs: T[] };

export function listAssets(params?: { asOrganization?: string; officeId?: string | null }) {
  return httpClient
    .get<ListResponse<Asset>>('/api/assets', {
      depth: '1',
      asOrganization: params?.asOrganization,
      'where[office][equals]': params?.officeId ?? undefined,
    })
    .then((r) => r.docs);
}
