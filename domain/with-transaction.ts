import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { createLocalReq, ValidationError, type Payload, type PayloadRequest } from 'payload'

export async function transactionLock(req: PayloadRequest, key: string) {
  const id = await req.transactionID
  const session = id && req.payload.db.sessions?.[id]
  if (!session) throw new Error('An active PostgreSQL transaction is required')
  await (session.db as PostgresAdapter['drizzle']).execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  )
}

export async function lockAssetRow(req: PayloadRequest, collection: 'assets' | 'non-network-assets', id: string) {
  const transactionID = await req.transactionID
  const session = transactionID && req.payload.db.sessions?.[transactionID]
  if (!session) throw new Error('An active PostgreSQL transaction is required')
  const table = collection === 'assets' ? 'assets' : 'non_network_assets'
  await (session.db as PostgresAdapter['drizzle']).execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id}::uuid FOR UPDATE`)
}

/** Preserve an inherited transaction; otherwise commit only after the entire command succeeds. */
export async function withTransaction<T>(
  payload: Payload,
  request: PayloadRequest | undefined,
  command: (req: PayloadRequest) => Promise<T>,
  options?: { isolationLevel: 'repeatable read' }
): Promise<T> {
  const req = request ?? await createLocalReq({}, payload)
  const previous = req.transactionID
  const owns = !previous
  for (let attempt = 0; ; attempt += 1) {
  const id = await (previous ?? payload.db.beginTransaction(options))
  if (!id) throw new Error('This operation requires PostgreSQL transactions')
  req.transactionID = id
  try {
    const result = await command(req)
    if (owns) await payload.db.commitTransaction(id)
    return result
  } catch (error) {
    if (owns) await payload.db.rollbackTransaction(id)
    // Retry the whole database command on PostgreSQL snapshot/deadlock conflicts, never a
    // subset of its writes. Callbacks must contain transactional DB operations only.
    let cause: unknown = error
    let retryable = false
    // Drizzle maps 23505 to a ValidationError and discards its SQL cause. The adapter adds
    // tableName only for database uniqueness errors; ordinary form validation is not retried.
    if (options?.isolationLevel === 'repeatable read' && error instanceof ValidationError) {
      const data = error.data as { errors?: Array<{ tableName?: string }> } | undefined
      retryable = Boolean(data?.errors?.some(field => field.tableName))
    }
    while (cause && typeof cause === 'object') {
      const detail = cause as { code?: string; cause?: unknown }
      if (detail.code === '40001' || detail.code === '40P01') retryable = true
      if (detail.code === '23505' && options?.isolationLevel === 'repeatable read') retryable = true
      cause = detail.cause
    }
    if (owns && retryable && attempt < 2) continue
    throw error
  } finally {
    if (owns) req.transactionID = previous
  }
  }
}
