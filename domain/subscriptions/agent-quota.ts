import type { Payload, PayloadRequest } from 'payload'
import { countsTowardAgentLimit } from '../agents/agent-state'
import { getSubscriptionLimits, type SubscriptionLevel } from './limits'

const organizationLocks = new Map<string, Promise<void>>()

// Distinguible de un error inesperado — una org sin subscriptions doc (legacy, en migración, o
// borrado) es una condición esperable, no un 500: los callers deben poder responder limpio.
export class SubscriptionNotFoundError extends Error {}

export function calculateAgentLimit(level: SubscriptionLevel, officeCount: number): number {
  return Math.max(0, officeCount) * getSubscriptionLimits(level).agents_per_office
}

// El sistema se ejecuta hoy como un único proceso Next/Payload. Esta cola serializa el check+create
// por organización dentro de ese proceso; si se despliega con múltiples réplicas deberá reemplazarse
// por un lock transaccional de PostgreSQL antes de escalar horizontalmente.
export async function withAgentQuotaLock<T>(
  organizationId: string,
  work: () => Promise<T>
): Promise<T> {
  const previous = organizationLocks.get(organizationId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => current)
  organizationLocks.set(organizationId, queued)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (organizationLocks.get(organizationId) === queued) organizationLocks.delete(organizationId)
  }
}

export async function getAgentQuota(
  payload: Payload,
  organizationId: string,
  req?: PayloadRequest,
  officeId?: string
): Promise<{ limit: number; used: number; available: number; per_office: number | null }> {
  const [subscriptions, offices, agents] = await Promise.all([
    payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'offices',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'agents',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
    }),
  ])
  const subscription = subscriptions.docs[0]
  if (!subscription) throw new SubscriptionNotFoundError('subscription_not_found')
  const level = subscription.level as SubscriptionLevel
  const limit = calculateAgentLimit(level, offices.totalDocs)
  const used = agents.docs.filter(countsTowardAgentLimit).length
  const perOffice = getSubscriptionLimits(level).agents_per_office
  const officeUsed = officeId
    ? agents.docs.filter(
        agent =>
          countsTowardAgentLimit(agent) &&
          String(typeof agent.office === 'object' ? agent.office?.id : agent.office) === officeId
      ).length
    : 0
  const organizationAvailable = Math.max(0, limit - used)
  const officeAvailable = perOffice === null ? organizationAvailable : Math.max(0, perOffice - officeUsed)
  return {
    limit,
    used,
    available: Math.min(organizationAvailable, officeAvailable),
    per_office: perOffice,
  }
}
