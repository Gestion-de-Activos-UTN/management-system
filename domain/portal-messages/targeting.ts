import { relationId } from '@/lib/relationId'

type MessageTarget = {
  scope: 'global' | 'organizations'
  target_kind: 'all' | 'role' | 'user'
  target_organizations?: unknown[]
  target_roles?: string[] | null
  target_users?: unknown[]
}

export function messageTargetsUser(
  message: MessageTarget,
  organizationId: string,
  role: string | null,
  userId: string
): boolean {
  if (message.scope === 'global') return true
  if (!message.target_organizations?.some(org => relationId(org) === organizationId)) return false
  if (message.target_kind === 'all') return true
  if (message.target_kind === 'role') return Boolean(role && message.target_roles?.includes(role))
  return Boolean(message.target_users?.some(user => relationId(user) === userId))
}
