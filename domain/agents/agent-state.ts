export const HEARTBEAT_INTERVAL_SECONDS = 300
export const OFFLINE_THRESHOLD_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2

export const AGENT_LIFECYCLE_STATUSES = ['provisioned', 'active', 'revoked'] as const
export type AgentLifecycleStatus = (typeof AGENT_LIFECYCLE_STATUSES)[number]

export const AGENT_RUNTIME_STATUSES = ['idle', 'scanning', 'unknown'] as const
export type AgentRuntimeStatus = (typeof AGENT_RUNTIME_STATUSES)[number]

export const AGENT_REVOCATION_REASONS = ['manual', 'auto_lockout_abuse'] as const
export type AgentRevocationReason = (typeof AGENT_REVOCATION_REASONS)[number]

// Umbrales del lockout escalonado por intentos fallidos (ver resolveAgentAuth.ts). El lockout
// temporal absorbe el abuso de corto plazo sin revocar; solo tras varios ciclos sostenidos
// (ESCALATION_THRESHOLD) se llega a la revocación automática — evita que un tercero que solo
// conoce el apiKeyPrefix (visible en UI/logs) tire abajo un agente legítimo con un solo burst.
export const AGENT_LOCKOUT_THRESHOLD = 10
export const AGENT_LOCKOUT_MINUTES = 15
export const AGENT_LOCKOUT_ESCALATION_THRESHOLD = 3

export function isAgentLockedOut(
  agent: { lockedUntil?: string | null },
  now = new Date()
): boolean {
  if (!agent.lockedUntil) return false
  return new Date(agent.lockedUntil).getTime() > now.getTime()
}

// Datos de escritura para revocar un agente — no hace DELETE físico (Assets/ScanReports
// mantienen `agent` como relación required, y Agents.delete está bloqueado por access) sino que
// reusa el estado terminal 'revoked' ya existente, marcando el motivo para que reportes/UI
// puedan distinguir una baja manual de una baja automática por abuso.
export function buildRevocationData(reason: AgentRevocationReason) {
  return {
    lifecycle_status: 'revoked' as const,
    is_active: false,
    revoked_at: new Date().toISOString(),
    revocation_reason: reason,
  }
}

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

export const AGENT_CONNECTIVITY_STATUSES = ['online', 'offline', 'pending', 'revoked'] as const
export type AgentConnectivity = (typeof AGENT_CONNECTIVITY_STATUSES)[number]

// Presentación derivada del mismo estado autoritativo — colección (afterRead de `status`), cuota
// y UI (officeAgentSummary.ts, AgentProvisionModal.tsx) deben llamar a esto en vez de reimplementar
// la combinación lifecycle/heartbeat cada uno por su lado.
export function getAgentConnectivity(
  agent: AgentStateInput,
  now = new Date()
): AgentConnectivity {
  if (getAgentLifecycleStatus(agent) === 'revoked') return 'revoked'
  if (!agent.last_heartbeat_at) return 'pending'
  return isAgentOnline(agent, now) ? 'online' : 'offline'
}

export function assertAgentTransition(from: AgentLifecycleStatus, to: AgentLifecycleStatus): void {
  if (from === to) return
  const allowed =
    (from === 'provisioned' && (to === 'active' || to === 'revoked')) ||
    (from === 'active' && to === 'revoked')
  if (!allowed) throw new Error(`Invalid agent lifecycle transition: ${from} -> ${to}`)
}
