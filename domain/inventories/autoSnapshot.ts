import type { Payload } from 'payload'
import { createInventorySnapshot } from './createInventorySnapshot'

// Mismo gap que DEFAULT_OFFLINE_AFTER_HOURS (agingSweep.ts) — default de plataforma cuando la
// organización no tiene override en OrganizationSettings.snapshot_interval_days.
export const DEFAULT_SNAPSHOT_INTERVAL_DAYS = 7

// Pura y testeable sin DB. `lastTakenAt: null` (nunca hubo snapshot en esta office) siempre
// dispara uno nuevo.
export function shouldTakeSnapshot(lastTakenAt: string | null, intervalDays: number, now: number): boolean {
  if (!lastTakenAt) return true
  const elapsedMs = now - new Date(lastTakenAt).getTime()
  return elapsedMs >= intervalDays * 24 * 60 * 60 * 1000
}

// Disparado desde endpoints/reports.ts en cada ingest. `snapshot_before_each_scan` (checkbox en
// OrganizationSettings) es mutuamente excluyente con `snapshot_interval_days` a nivel UI (admin
// condition) — acá el booleano simplemente gana si está en true, sin mirar el intervalo.
export async function maybeCreateAutoSnapshot(payload: Payload, officeId: string, organizationId: string) {
  const settingsResult = await payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const settings = settingsResult.docs[0]

  if (settings?.snapshot_before_each_scan) {
    await createInventorySnapshot(payload, officeId, { type: 'scheduled' })
    return
  }

  const intervalDays =
    typeof settings?.snapshot_interval_days === 'number' && settings.snapshot_interval_days > 0
      ? settings.snapshot_interval_days
      : DEFAULT_SNAPSHOT_INTERVAL_DAYS

  const lastSnapshotResult = await payload.find({
    collection: 'inventory-snapshots',
    where: { office: { equals: officeId } },
    sort: '-taken_at',
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const lastTakenAt = lastSnapshotResult.docs[0]?.taken_at ?? null

  if (shouldTakeSnapshot(lastTakenAt, intervalDays, Date.now())) {
    await createInventorySnapshot(payload, officeId, { type: 'scheduled' })
  }
}
