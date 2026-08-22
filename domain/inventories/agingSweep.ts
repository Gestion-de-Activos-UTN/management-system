import type { Payload } from 'payload'

// Sin AppSettings singleton todavía (mismo gap que risk_score_policy) — este es el default de
// plataforma cuando una organización no tiene override en OrganizationSettings.offline_after_hours.
export const DEFAULT_OFFLINE_AFTER_HOURS = 72

export interface AgingSweepSummary {
  assets_transitioned: number
  organizations_processed: number
}

// Pura y testeable sin DB — el resto de la función es I/O (Payload find/update). `lastSeen: null`
// (nunca hubo scan, teóricamente imposible por como ingestScanReport siempre lo setea, pero no se
// asume) cuenta como "vencido hace la eternidad", nunca como "recién visto".
export function shouldGoOffline(lastSeen: string | null, offlineAfterHours: number, now: number): boolean {
  const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0
  const elapsedHours = (now - lastSeenMs) / (1000 * 60 * 60)
  return elapsedHours >= offlineAfterHours
}

async function fetchOfflineAfterHours(payload: Payload, organizationId: string): Promise<number> {
  const result = await payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const configured = result.docs[0]?.offline_after_hours
  return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_OFFLINE_AFTER_HOURS
}

// El umbral es por organización, nunca una ventana global fija (doc 05 §5.3) — dos organizaciones
// con distinta tolerancia a inactividad pueden dar resultados distintos en la misma corrida. El
// filtro `status: 'active'` en la query, no una exclusión aparte, es lo que garantiza que un Asset
// 'retired' nunca entra en este loop.
async function sweepActiveAssets(payload: Payload, now: number): Promise<AgingSweepSummary> {
  const offlineAfterHoursByOrg = new Map<string, number>()
  const organizationsSeen = new Set<string>()
  let transitioned = 0
  let page = 1

  for (;;) {
    const result = await payload.find({
      collection: 'assets',
      where: { status: { equals: 'active' } },
      overrideAccess: true,
      depth: 0,
      limit: 200,
      page,
    })

    for (const asset of result.docs) {
      const organizationId = String(asset.organization)
      organizationsSeen.add(organizationId)

      let offlineAfterHours = offlineAfterHoursByOrg.get(organizationId)
      if (offlineAfterHours === undefined) {
        offlineAfterHours = await fetchOfflineAfterHours(payload, organizationId)
        offlineAfterHoursByOrg.set(organizationId, offlineAfterHours)
      }

      if (!shouldGoOffline(asset.last_seen ?? null, offlineAfterHours, now)) continue

      await payload.update({
        collection: 'assets',
        id: asset.id,
        overrideAccess: true,
        context: { systemJob: true },
        data: { status: 'offline' },
      })
      transitioned += 1
    }

    if (!result.hasNextPage) break
    page += 1
  }

  return { assets_transitioned: transitioned, organizations_processed: organizationsSeen.size }
}

// Disparado manualmente hoy (endpoints/internalJobs.ts) — ver ese archivo para por qué no hay
// scheduler cableado todavía. Registra la corrida en JobRun sea cual sea el resultado, para que
// el historial de ejecuciones no dependa de mirar logs de proceso.
export async function agingSweep(payload: Payload): Promise<AgingSweepSummary> {
  const startedAt = new Date().toISOString()
  const jobRun = await payload.create({
    collection: 'job-runs',
    overrideAccess: true,
    data: { job_type: 'aging_sweep', started_at: startedAt, status: 'running' },
  })

  try {
    const summary = await sweepActiveAssets(payload, Date.now())
    await payload.update({
      collection: 'job-runs',
      id: jobRun.id,
      overrideAccess: true,
      data: { finished_at: new Date().toISOString(), status: 'success', summary: { ...summary } },
    })
    return summary
  } catch (err) {
    await payload.update({
      collection: 'job-runs',
      id: jobRun.id,
      overrideAccess: true,
      data: {
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    })
    throw err
  }
}
