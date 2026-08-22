import { listResource } from '@/lib/list-resource';
import { httpClient } from '@/lib/http-client';
import type { InventorySnapshot } from '@/app/types/payload-types';

export function listSnapshots(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<InventorySnapshot>('/api/inventory-snapshots', {
    depth: '0',
    sort: '-taken_at',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  });
}

export function getSnapshot(id: string) {
  return httpClient.get<InventorySnapshot>(`/api/inventory-snapshots/${id}`, { depth: '0' });
}

// generated_by siempre 'manual' acá — 'scheduled'/'pre_audit' quedan reservados para cuando
// exista un disparador automático (ver endpoints/internalJobs.ts, sin cron cableado todavía).
export function generateSnapshot(officeId: string) {
  return httpClient.post<InventorySnapshot>('/api/v1/inventory-snapshots/generate', { office_id: officeId });
}
