import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'

// Acceso a la transacción en curso y advisory locks de transacción. Separado de
// with-transaction.ts para que el cierre del AuditLog (domain/audit/chain.ts) tome los mismos
// locks sin importar with-transaction.ts, que a su vez llama al cierre. La misma clave produce
// siempre el mismo lock: hashtextextended(key, 0).

export async function transactionDb(req: PayloadRequest) {
  const id = await req.transactionID
  const session = id && req.payload.db.sessions?.[id]
  if (!session) throw new Error('An active PostgreSQL transaction is required')
  return session.db as PostgresAdapter['drizzle']
}

export async function transactionLock(req: PayloadRequest, key: string) {
  await (
    await transactionDb(req)
  ).execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

export async function tryTransactionLock(req: PayloadRequest, key: string): Promise<boolean> {
  const result = await (
    await transactionDb(req)
  ).execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`)
  return Boolean((result.rows[0] as { locked?: boolean } | undefined)?.locked)
}
