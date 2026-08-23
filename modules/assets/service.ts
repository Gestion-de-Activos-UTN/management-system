import { listResource } from '@/lib/list-resource';
import { httpClient } from '@/lib/http-client';
import type { Asset } from '@/app/types/payload-types';
import type { AssetBusinessFields } from './schema';

export function listAssets(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<Asset>('/api/assets', {
    depth: '1',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  });
}

export function getAsset(id: string) {
  return httpClient.get<Asset>(`/api/assets/${id}`, { depth: '1' });
}

// Solo el bloque de negocio — los campos técnicos son read-only en UI (RF-55) y el servidor los
// rechaza igual vía technicalFieldAccess si alguna vez se colaran acá.
export function updateAsset(id: string, data: Partial<AssetBusinessFields>) {
  return httpClient.patch<Asset>(`/api/assets/${id}`, data);
}

// Apaga el badge "NEW" de la tabla la primera vez que alguien entra al detalle. Nunca se llama
// dos veces con intención (ver useMarkAssetViewed) — un re-scan jamás pasa por acá.
export function markAssetViewed(id: string) {
  return httpClient.patch<Asset>(`/api/assets/${id}`, { first_viewed_at: new Date().toISOString() });
}
