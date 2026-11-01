import type { PayloadRequest } from 'payload'

export type RecalculationStatus = 'current' | 'pending' | 'processing' | 'failed' | 'outdated'

type OpenRiskJob = { id: string | number; hasError?: boolean | null; processing?: boolean | null }

/** Latest unfinished recalculation for one scope; omitting the office reads the organization. */
export async function openRiskJob(
  req: PayloadRequest,
  organizationId: string,
  officeId?: string
): Promise<OpenRiskJob | undefined> {
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
  return jobs.docs[0]
}

export const riskJobStatus = (job: OpenRiskJob): RecalculationStatus =>
  job.hasError ? 'failed' : job.processing ? 'processing' : 'pending'

/** Only expose state for the already-authorized organization/office, never job input or errors. */
export async function riskRecalculationStatus(
  req: PayloadRequest,
  organizationId: string,
  officeId?: string,
  evaluatedAt?: string | null
): Promise<RecalculationStatus> {
  const job = await openRiskJob(req, organizationId, officeId)
  // Every input change enqueues a job, so without one the latest evaluation is current; only a
  // scope that was never evaluated is outdated.
  if (!job) return evaluatedAt ? 'current' : 'outdated'
  return riskJobStatus(job)
}
