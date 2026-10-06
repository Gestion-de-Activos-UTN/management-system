import type { NetworkBaselineRule } from './catalog-types'
import { NETWORK_BASELINE } from './network-baseline'

export function validateNetworkBaseline(rules: readonly NetworkBaselineRule[]): void {
  const keys = new Set<string>()
  for (const rule of rules) {
    if (keys.has(rule.key)) throw new Error(`Network rule ${rule.key} is duplicated`)
    keys.add(rule.key)
    if (rule.control_key !== 'A.8.21')
      throw new Error(`Network rule ${rule.key} must belong to A.8.21`)
    if (rule.minimum_confidence < 0 || rule.minimum_confidence > 10)
      throw new Error(`Network rule ${rule.key} has invalid confidence`)
    if (
      !rule.ports.length ||
      rule.ports.some(port => !Number.isInteger(port) || port < 0 || port > 65535)
    )
      throw new Error(`Network rule ${rule.key} has invalid ports`)
  }
}

// Catalog errors are deployment errors: fail fast instead of classifying services ambiguously.
validateNetworkBaseline(NETWORK_BASELINE)

export * from './catalog-types'
export * from './network-baseline'
