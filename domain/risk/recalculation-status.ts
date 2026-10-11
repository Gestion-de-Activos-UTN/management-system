import type { PayloadRequest } from 'payload'

export type RecalculationStatus = 'current' | 'pending' | 'processing' | 'failed' | 'outdated'

/** Only expose state for the already-authorized organization/office, never job input or errors. */
export async function riskRecalculationStatus(
  req: PayloadRequest,
  organizationId: string,
  officeId?: string,
  evaluatedAt?: string | null
): Promise<RecalculationStatus> {
  const jobs = await req.payload.find({
    collection: 'payload-jobs',
    req,
    overrideAccess: true,
    depth: 0,
    limit: 1,
    sort: '-createdAt',
    where: {
      and: [
        { queue: { equals: 'risk' } },
        { concurrencyKey: { equals: `risk:${organizationId}:${officeId || 'org'}` } },
        { completedAt: { exists: false } },
      ],
    },
  })
  const job = jobs.docs[0]
  // Every input change enqueues a job, so without one the latest evaluation is current; only a
  // scope that was never evaluated is outdated.
  if (!job) return evaluatedAt ? 'current' : 'outdated'
  return job.hasError ? 'failed' : job.processing ? 'processing' : 'pending'
}
