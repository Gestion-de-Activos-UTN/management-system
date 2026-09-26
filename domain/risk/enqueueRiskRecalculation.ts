import type { Payload } from 'payload'

/**
 * Queues the organization-wide evaluation and, when the change belongs to one office, that office's
 * evaluation too; otherwise the organization view would stay stale after office-level events.
 */
export async function enqueueRiskRecalculation(
  payload: Payload,
  input: { organizationId: string; officeId?: string }
) {
  if (process.env.PAYLOAD_DISABLE_JOBS === '1' || !payload.jobs?.queue) return
  const officeIds = input.officeId ? [undefined, input.officeId] : [undefined]
  for (const officeId of officeIds) {
    // Duplicate jobs are safe: each run appends a new evaluation and never rewrites history.
    await payload.jobs.queue({
      task: 'recalculate-risk',
      queue: 'risk',
      input: { organization_id: input.organizationId, office_id: officeId },
    })
  }
}
