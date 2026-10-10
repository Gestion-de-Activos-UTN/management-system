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
  if (!job) return !evaluatedAt || Date.now() - Date.parse(evaluatedAt) >= 5 * 60 * 1000 ? 'outdated' : 'current'
  return job.hasError ? 'failed' : job.processing ? 'processing' : 'pending'
}
