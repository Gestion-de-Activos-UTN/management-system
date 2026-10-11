import { isAgentOnline } from '../domain/agents/agent-state'

// Compatibilidad para consumidores de UI/endpoints existentes. La regla autoritativa vive en
// domain/agents/agent-state.ts para que colección, cuota y presentación no puedan divergir.
export { HEARTBEAT_INTERVAL_SECONDS, OFFLINE_THRESHOLD_SECONDS } from '../domain/agents/agent-state'

export function isOnline(lastHeartbeatAt: string | null | undefined): boolean {
  return isAgentOnline({ last_heartbeat_at: lastHeartbeatAt })
}
