export const HEARTBEAT_INTERVAL_SECONDS = 300
export const OFFLINE_THRESHOLD_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2

export const AGENT_LIFECYCLE_STATUSES = ['provisioned', 'active', 'revoked'] as const
export type AgentLifecycleStatus = (typeof AGENT_LIFECYCLE_STATUSES)[number]

export const AGENT_RUNTIME_STATUSES = ['idle', 'scanning', 'unknown'] as const
export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number]

export interface AgentStateInput {
  lifecycle_status?: string | null
  is_active?: boolean | null
  last_heartbeat_at?: string | null
}

export function isAgentOnline(
  agent: Pick<AgentStateInput, 'last_heartbeat_at'>,
  now = new Date()
): boolean {
  if (!agent.last_heartbeat_at) return false
  const heartbeatAt = new Date(agent.last_heartbeat_at).getTime()
  if (!Number.isFinite(heartbeatAt) || heartbeatAt > now.getTime()) return false
  return (now.getTime() - heartbeatAt) / 1000 <= OFFLINE_THRESHOLD_SECONDS
}

export function getAgentLifecycleStatus(agent: AgentStateInput): AgentLifecycleStatus {
  if (agent.lifecycle_status === 'revoked' || agent.is_active === false) return 'revoked'
  if (agent.lifecycle_status === 'active' || agent.last_heartbeat_at) return 'active'
  return 'provisioned'
}

export function countsTowardAgentLimit(agent: AgentStateInput): boolean {
  return getAgentLifecycleStatus(agent) !== 'revoked'
}

export function assertAgentTransition(from: AgentLifecycleStatus, to: AgentLifecycleStatus): void {
  if (from === to) return
  const allowed =
    (from === 'provisioned' && (to === 'active' || to === 'revoked')) ||
    (from === 'active' && to === 'revoked')
  if (!allowed) throw new Error(`Invalid agent lifecycle transition: ${from} -> ${to}`)
}
