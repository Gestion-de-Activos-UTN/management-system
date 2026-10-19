import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { findActiveOffices } from '@/domain/offices/active-offices'

/**
 * Queues the organization-wide evaluation plus one per affected office; otherwise the organization
 * view would stay stale after office-level events. Callers pass every office the change touched
 * (e.g. the previous office of a moved asset); empty and repeated ids are dropped.
 */
export async function enqueueRiskRecalculation(
  payload: Payload,
  organizationId: string,
  officeIds: ReadonlyArray<string | null | undefined> = [],
  request?: PayloadRequest
) {
  if (process.env.PAYLOAD_DISABLE_JOBS === '1' || !payload.jobs?.queue) return
  if (payload.config?.jobs?.runHooks)
    throw new Error('Transactional risk queue requires jobs.runHooks=false')
  const req = request ?? (await createLocalReq({}, payload))
  // ponytail: no filtra organizaciones ni oficinas inactivas acá; el handler de 'recalculate-risk'
  // (payload.config.ts) las descarta al correr, sin sumar queries en cada evento de activo.
  const previous = req.transactionID
  const ownsTransaction = !previous
  const transactionID = await (previous ?? payload.db.beginTransaction())
  if (!transactionID) throw new Error('Risk delivery requires PostgreSQL transactions')
  req.transactionID = transactionID
  const offices = [...new Set(officeIds.filter((id): id is string => Boolean(id)))]
  try {
    for (const officeId of [undefined, ...offices]) {
      // The task's concurrency key (payload.config.ts) supersedes pending jobs for the same scope, so
      // a burst of events collapses into one pending run instead of piling up.
      // AUDIT: this action must emit an AuditLogs entry (organization/office risk recalculation intent)
      // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
      await payload.jobs.queue({
        req,
        task: 'recalculate-risk',
        queue: 'risk',
        input: { organization_id: organizationId, office_id: officeId },
      })
    }
    if (ownsTransaction) await payload.db.commitTransaction(transactionID)
  } catch (error) {
    if (ownsTransaction) await payload.db.rollbackTransaction(transactionID)
    throw error
  } finally {
    if (ownsTransaction) req.transactionID = previous
  }
}

/** Organization-level events (policy, organization answers) change every office evaluation. */
export async function enqueueOrganizationRiskRecalculation(
  payload: Payload,
  organizationId: string,
  req?: PayloadRequest
) {
  if (process.env.PAYLOAD_DISABLE_JOBS === '1' || !payload.jobs?.queue) return
  const offices = await findActiveOffices(payload, organizationId, req)
  await enqueueRiskRecalculation(
    payload,
    organizationId,
    offices.map(office => String(office.id)),
    req
  )
}
