/**
 * Absence is negative evidence only for a port actually scanned with complete coverage.
 * A report row is partial when any host timed out; an asset whose own port scan finished
 * (`asset_coverage.port_scan === 'complete'`) still had those ranges fully scanned.
 */
export function portWasCovered(coverage: unknown, key: string, assetPortScanComplete = false): boolean {
  const [protocol, rawPort] = key.split(':')
  const port = Number(rawPort)
  if (!rawPort || !Number.isInteger(port) || port < 0 || port > 65535 || !Array.isArray(coverage)) return false
  return coverage.some(value => {
    if (!value || typeof value !== 'object') return false
    const row = value as { protocol?: string; status?: string; port_spec?: unknown }
    const rowCovered = row.status === 'complete' || (assetPortScanComplete && row.status === 'partial')
    if (row.protocol !== protocol || !rowCovered || typeof row.port_spec !== 'string') return false
    return row.port_spec.split(',').some(part => {
      if (!/^\d+(?:-\d+)?$/.test(part.trim())) return false
      const [start, end = start] = part.trim().split('-').map(Number)
      return start <= port && port <= end && start >= 0 && end <= 65535
    })
  })
}
