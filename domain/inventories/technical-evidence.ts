export const RAW_TECHNICAL_RETENTION_DAYS = 30

/** Strip raw script outputs, preserving normalized inventory and the original value. */
export function redactTechnicalEvidence<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactTechnicalEvidence) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'host_scripts' && key !== 'scripts')
      .map(([key, item]) => [key, redactTechnicalEvidence(item)])
  ) as T
}

export function observationExpired(lastSeen: unknown, cutoff: number): boolean {
  const time = typeof lastSeen === 'string' ? Date.parse(lastSeen) : NaN
  // Unknown observation time cannot justify keeping raw evidence indefinitely.
  return !Number.isFinite(time) || time <= cutoff
}

export function expireSnapshotTechnicalEvidence<T>(dump: T, cutoff: number): T {
  if (!dump || typeof dump !== 'object' || Array.isArray(dump)) return dump
  const network = (dump as { network?: unknown }).network
  if (!Array.isArray(network)) return dump
  return {
    ...dump,
    network: network.map(asset =>
      asset && typeof asset === 'object' && observationExpired(asset.last_seen, cutoff)
        ? redactTechnicalEvidence(asset)
        : asset
    ),
  }
}
