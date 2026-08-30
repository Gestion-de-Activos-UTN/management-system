export const HEARTBEAT_INTERVAL_SECONDS = 300
export const OFFLINE_THRESHOLD_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2

export function isOnline(lastHeartbeatAt: string | null | undefined): boolean {
  if (!lastHeartbeatAt) return false
  return (Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000 <= OFFLINE_THRESHOLD_SECONDS
}
