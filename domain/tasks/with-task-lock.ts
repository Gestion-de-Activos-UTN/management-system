import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

/** Serialize domain commands for a task; Payload still performs all writes and hooks. */
export async function withTaskLock<T>(req: PayloadRequest, id: string, command: () => Promise<T>) {
  const previous = req.transactionID
  const ownsTransaction = !previous
  const transactionID = await (previous ?? req.payload.db.beginTransaction())
  if (!transactionID) throw new Error('Task commands require PostgreSQL transactions')
  req.transactionID = transactionID
  try {
    const session = req.payload.db.sessions?.[transactionID]
    if (!session) throw new Error('Task transaction is not active')
    // Transaction-scoped lock precedes all reads. Waiting commands re-read the committed state.
    const transaction = session.db as PostgresAdapter['drizzle']
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task:${id}`}, 0))`
    )
    const result = await command()
    if (ownsTransaction) await req.payload.db.commitTransaction(transactionID)
    return result
  } catch (error) {
    if (ownsTransaction) await req.payload.db.rollbackTransaction(transactionID)
    throw error
  } finally {
    if (ownsTransaction) req.transactionID = previous
  }
}
