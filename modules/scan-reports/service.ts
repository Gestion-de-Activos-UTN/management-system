import { listResource } from '@/lib/list-resource';
import { httpClient } from '@/lib/http-client';
import type { ScanReport } from '@/app/types/payload-types';

export function listScanReports(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<ScanReport>('/api/scan-reports', {
    sort: '-scan_start',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  });
}

// Liviano a propósito (limit=1, solo processed) — usado para el polling del banner "new scan
// result" en /portal/inventory, no para listar. `status=processed` evita mostrar el banner para
// un reporte que ingestScanReport.ts todavía está escribiendo (processed_at solo se setea al final).
export function getLatestProcessedScanReport(params?: { asOrganization?: string; officeId?: string | null }) {
  return listResource<ScanReport>('/api/scan-reports', {
    sort: '-processed_at',
    limit: '1',
    'where[status][equals]': 'processed',
    asOrganization: params?.asOrganization,
    'where[office][equals]': params?.officeId ?? undefined,
  }).then((docs) => docs[0] ?? null);
}

export function getScanReport(id: string) {
  // depth:1 para poblar `agent` (mostrado en el detalle) — su único campo propio es el id,
  // no hace falta más profundidad.
  return httpClient.get<ScanReport>(`/api/scan-reports/${id}`, { depth: '1' });
}

// `error` guarda el JSON de rejectedAssets producido por ingestScanReport.ts, o null si nada
// se rechazó — nunca un mensaje de error libre (ver endpoints/reports.ts).
export type RejectedAsset = { asset_id: string; error: string };
export type ReportedAsset = { asset_id: string; ip: string; hostname: string; mac: string };

function rawAssets(rawPayload: ScanReport['raw_payload']): ReportedAsset[] {
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    const assets = (rawPayload as { assets?: unknown }).assets;
    if (Array.isArray(assets)) return assets as ReportedAsset[];
  }
  return [];
}

export function parseRejectedAssets(error: string | null | undefined): RejectedAsset[] {
  if (!error) return [];
  try {
    const parsed = JSON.parse(error);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function totalAssetsInReport(rawPayload: ScanReport['raw_payload']): number {
  return rawAssets(rawPayload).length;
}

export function acceptedAssetsInReport(
  rawPayload: ScanReport['raw_payload'],
  rejected: RejectedAsset[],
): ReportedAsset[] {
  const rejectedIds = new Set(rejected.map((r) => r.asset_id));
  return rawAssets(rawPayload).filter((a) => !rejectedIds.has(a.asset_id));
}
