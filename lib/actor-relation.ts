import type { PayloadRequest } from 'payload'
import { relationId } from './relationId'

/** Human actors retain their authentication collection; admins are never implicit members. */
export function actorRelation(req: Pick<PayloadRequest, 'user'>, id: string) {
  return {
    relationTo:
      req.user?.collection === 'admins' && String(req.user.id) === id
        ? ('admins' as const)
        : ('users' as const),
    value: id,
  }
}

export function actorMatches(value: unknown, ctx: { userId: string; isPlatformAdmin: boolean }) {
  if (!value) return false
  const collection = typeof value === 'object' && 'relationTo' in value ? value.relationTo : 'users'
  return (
    collection === (ctx.isPlatformAdmin ? 'admins' : 'users') && relationId(value) === ctx.userId
  )
}
