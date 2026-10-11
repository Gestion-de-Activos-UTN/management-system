import type { Payload } from 'payload'

/** Startup recovery assumes this process is the only worker; never release another live worker. */
export async function recoverJobsOnStartup(payload: Payload) {
  if (process.env.SIAM_JOB_RECOVERY_ON_START === '0') return
  // AUDIT: this action must emit an AuditLogs entry (recovery of abandoned risk/maintenance jobs)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await payload.update({
    collection: 'payload-jobs',
    where: { and: [{ queue: { in: ['risk', 'maintenance'] } }, { processing: { equals: true } }] },
    data: { processing: false },
    overrideAccess: true,
  })
}
