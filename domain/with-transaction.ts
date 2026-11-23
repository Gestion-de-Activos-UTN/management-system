import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { createLocalReq, ValidationError, type Payload, type PayloadRequest } from 'payload'
import {
  discardAuditEvents,
  openAuditTransaction,
  takeAuditEvents,
  type AuditTransactionId,
} from './audit/builder'

async function transactionDb(req: PayloadRequest) {
  const id = await req.transactionID
  const session = id && req.payload.db.sessions?.[id]
  if (!session) throw new Error('An active PostgreSQL transaction is required')
  return session.db as PostgresAdapter['drizzle']
}

export async function transactionLock(req: PayloadRequest, key: string) {
  await (await transactionDb(req)).execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

async function tryTransactionLock(req: PayloadRequest, key: string): Promise<boolean> {
  const result = await (await transactionDb(req)).execute(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`
  )
  return Boolean((result.rows[0] as { locked?: boolean } | undefined)?.locked)
}

/** Blocks until `key` is free, in a throwaway READ COMMITTED transaction, then releases it. */
async function waitForLock(payload: Payload, key: string) {
  const id = await payload.db.beginTransaction()
  if (!id) throw new Error('This operation requires PostgreSQL transactions')
  const req = await createLocalReq({}, payload)
  req.transactionID = id
  try {
    await transactionLock(req, key)
  } finally {
    await payload.db.commitTransaction(id)
  }
}

export async function lockAssetRow(
  req: PayloadRequest,
  collection: 'assets' | 'non-network-assets' | 'inventory-snapshots',
  id: string
) {
  const table = collection.replaceAll('-', '_')
  await (await transactionDb(req)).execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id}::uuid FOR UPDATE`)
}

/**
 * Cierre con auditoría (documentation/planes/audit-log/03-seguridad-y-claves.md §4): el único
 * COMMIT de una transacción que puede tener eventos. Toma los eventos del buffer (borra la entrada),
 * los escribe en su cadena y confirma. Si algo falla, revierte y relanza: sin auditoría no hay
 * cambio. Revertir dos veces no hace nada (Payload ignora una sesión que ya no existe).
 */
export async function commitTransactionWithAudit(req: PayloadRequest, id: AuditTransactionId) {
  const events = takeAuditEvents(id)
  try {
    if (events.length > 0) {
      // Provisorio (F1b paso 4b, primer commit): la escritura en la cadena (chain.ts) llega en el
      // commit siguiente. Mientras tanto, un comando con eventos no se confirma.
      throw new Error('AuditLog: la escritura en la cadena todavía no está implementada.')
    }
    await req.payload.db.commitTransaction(id)
  } catch (error) {
    await req.payload.db.rollbackTransaction(id)
    throw error
  }
}

/** Rollback con auditoría: descarta los eventos de la transacción (borra la entrada) y revierte. */
export async function rollbackTransactionWithAudit(req: PayloadRequest, id: AuditTransactionId) {
  discardAuditEvents(id)
  await req.payload.db.rollbackTransaction(id)
}

/**
 * Preserve an inherited transaction; otherwise commit only after the entire command succeeds.
 * Una transacción propia abre su buffer de auditoría al empezar, y todo camino de cierre lo borra:
 * commit (commitTransactionWithAudit), rollback, excepción y reintento (el finally, por si el
 * rollback mismo falla). Una transacción heredada solo acumula: la cierra su dueño.
 */
export async function withTransaction<T>(
  payload: Payload,
  request: PayloadRequest | undefined,
  command: (req: PayloadRequest) => Promise<T>,
  options?: { isolationLevel?: 'repeatable read'; lockKey?: string }
): Promise<T> {
  const req = request ?? await createLocalReq({}, payload)
  const previous = req.transactionID
  const owns = !previous
  for (let attempt = 0; ; attempt += 1) {
  const id = await (previous ?? payload.db.beginTransaction(options?.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined))
  if (!id) throw new Error('This operation requires PostgreSQL transactions')
  req.transactionID = id
  try {
    if (owns) openAuditTransaction(id)
    if (options?.lockKey) {
      // REPEATABLE READ fixes its snapshot at the first statement, so blocking on the lock there
      // would leave this transaction reading data from before the holder committed. Only try it;
      // when busy, wait outside and restart with a fresh snapshot.
      // ponytail: unbounded wait loop; it ends because every holder commits or rolls back.
      if (!owns) await transactionLock(req, options.lockKey)
      else if (!(await tryTransactionLock(req, options.lockKey))) {
        await rollbackTransactionWithAudit(req, id)
        await waitForLock(payload, options.lockKey)
        attempt -= 1
        continue
      }
    }
    const result = await command(req)
    if (owns) await commitTransactionWithAudit(req, id)
    return result
  } catch (error) {
    if (owns) await rollbackTransactionWithAudit(req, id)
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
    if (owns) {
      discardAuditEvents(id)
      req.transactionID = previous
    }
  }
  }
}
