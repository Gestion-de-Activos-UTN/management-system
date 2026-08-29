import { listResource } from '@/lib/list-resource';
import { httpClient } from '@/lib/http-client';
import type { NonNetworkAsset } from '@/app/types/payload-types';
import type { NonNetworkAssetFormValues } from './schema';

export function listNonNetworkAssets(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<NonNetworkAsset>('/api/non-network-assets', {
    depth: '1',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  });
}

export function createNonNetworkAsset(values: NonNetworkAssetFormValues) {
  return httpClient.post<NonNetworkAsset>('/api/non-network-assets', values);
}

export function updateNonNetworkAsset(id: string, values: NonNetworkAssetFormValues) {
  return httpClient.patch<NonNetworkAsset>(`/api/non-network-assets/${id}`, values);
}

// RF-53a: confirmar una revisión no reenvía el resto de los campos — su propio endpoint,
// no un PATCH genérico (ver endpoints/nonNetworkAssetReview.ts).
export function markReviewed(id: string) {
  return httpClient.patch<NonNetworkAsset>(`/api/v1/non-network-assets/${id}/review`, {});
}
