import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import {
  Forbidden,
  type CollectionBeforeOperationHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeLoginHook,
  type CollectionAfterLogoutHook,
  type PayloadRequest,
} from 'payload'
import { rejectInactiveLogin } from './rejectInactiveLogin'

async function lockAccount(
  req: PayloadRequest,
  collection: 'users' | 'admins',
  id: string | number
) {
  const transactionID = await req.transactionID
  const session = transactionID && req.payload.db.sessions?.[transactionID]
  if (!session) throw new Error('Account session operations require a transaction')
  const transaction = session.db as PostgresAdapter['drizzle']
  // Row locks also coordinate with Payload's native session writes.
  await transaction.execute(
    sql`SELECT id FROM ${sql.identifier(collection)} WHERE id = ${id} FOR UPDATE`
  )
  return req.payload.db.findOne<{ id: string; status?: string; sessions?: { id: string }[] }>({
    collection,
    req,
    where: { id: { equals: id } },
  })
}

export const guardSessionOperation: CollectionBeforeOperationHook = async ({
  operation,
  req,
  collection,
  args,
}) => {
  if (collection.slug !== 'users' && collection.slug !== 'admins') return args
  if (
    operation === 'update' &&
    'id' in args &&
    (typeof args.id === 'string' || typeof args.id === 'number')
  )
    await lockAccount(req, collection.slug, args.id)
  if (operation === 'refresh') {
    if (!req.user || req.user.collection !== collection.slug) throw new Forbidden(req.t)
    const current = await lockAccount(req, collection.slug, req.user.id)
    const sid = (req.user as unknown as { _sid?: string })._sid
    if (!current || current.status !== 'active' || !current.sessions?.some(s => s.id === sid))
      throw new Forbidden(req.t)
  }
  return args
}

export const prepareAccountLogin: CollectionBeforeLoginHook = async ({
  collection,
  req,
  user,
  context,
}) => {
  if (collection.slug !== 'users' && collection.slug !== 'admins') throw new Forbidden(req.t)
  const current = await lockAccount(req, collection.slug, user.id)
  if (!current) throw new Forbidden(req.t)
  await rejectInactiveLogin({ collection, req, user: current, context })
  // The patched native operation invokes this BEFORE adding a session: use committed state.
  return { ...user, ...current, collection: collection.slug, _strategy: 'local-jwt' }
}

export const lockLogout: CollectionAfterLogoutHook = async ({ collection, req }) => {
  if ((collection.slug === 'users' || collection.slug === 'admins') && req.user)
    await lockAccount(req, collection.slug, req.user.id)
}

export const revokeInactiveSessions: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if ((data.status ?? originalDoc?.status) !== 'inactive') return data
  // AUDIT: this action must emit an AuditLogs entry (account deactivation and all-session revocation)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for the deactivated account
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively
  return { ...data, sessions: [] }
}
