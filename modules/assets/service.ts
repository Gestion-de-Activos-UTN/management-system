import { listResource } from '@/lib/list-resource';
import type { Asset } from '@/app/types/payload-types';

export function listAssets(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<Asset>('/api/assets', {
    depth: '1',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  });
}
