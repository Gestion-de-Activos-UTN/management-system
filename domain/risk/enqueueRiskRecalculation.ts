import type { Payload } from 'payload'

/**
 * Queues the organization-wide evaluation plus one per affected office; otherwise the organization
 * view would stay stale after office-level events. Callers pass every office the change touched
 * (e.g. the previous office of a moved asset); empty and repeated ids are dropped.
 */
export async function enqueueRiskRecalculation(
  payload: Payload,
  organizationId: string,
  officeIds: ReadonlyArray<string | null | undefined> = []
) {
  if (process.env.PAYLOAD_DISABLE_JOBS === '1' || !payload.jobs?.queue) return
  const offices = [...new Set(officeIds.filter((id): id is string => Boolean(id)))]
  for (const officeId of [undefined, ...offices]) {
    // The task's concurrency key (payload.config.ts) supersedes pending jobs for the same scope, so
    // a burst of events collapses into one pending run instead of piling up.
    await payload.jobs.queue({
      task: 'recalculate-risk',
      queue: 'risk',
      input: { organization_id: organizationId, office_id: officeId },
    })
  }
}

/** Organization-level events (policy, organization answers) change every office evaluation. */
export async function enqueueOrganizationRiskRecalculation(
  payload: Payload,
  organizationId: string
) {
  if (process.env.PAYLOAD_DISABLE_JOBS === '1' || !payload.jobs?.queue) return
  const offices = await payload.find({
    collection: 'offices',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    depth: 0,
    pagination: false,
    select: {},
  })
  await enqueueRiskRecalculation(
    payload,
    organizationId,
    offices.docs.map(office => String(office.id))
  )
}
