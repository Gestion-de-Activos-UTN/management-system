import type { ScannedAssetType } from '@/domain/assets/asset-types'
import { NETWORK_BASELINE, type NetworkBaselineRule } from './catalog'
import type { CheckEvaluation } from './evaluateCompliance'

type ObservedService = {
  port?: number | null
  protocol?: string | null
  state?: string | null
  confidence?: number | null
  name?: string | null
  product?: string | null
  version?: string | null
  tunnel?: string | null
}

export type NetworkEvaluation = CheckEvaluation & {
  check_key: string
  control_key: string
  service_key: string
  evidence: ObservedService
}

export function evaluateNetworkBaseline(input: {
  confirmed_type: ScannedAssetType | null
  port_coverage: 'complete' | 'partial' | 'not_attempted' | 'unknown'
  service_coverage: 'complete' | 'partial' | 'not_attempted' | 'unknown'
  services: readonly ObservedService[]
}): NetworkEvaluation[] {
  const rules: readonly NetworkBaselineRule[] = NETWORK_BASELINE
  return input.services.flatMap<NetworkEvaluation>(service => {
    if (service.state !== 'open' || service.port == null || !service.protocol) return []
    const serviceKey = `${service.protocol}:${service.port}`
    if (input.port_coverage !== 'complete' || input.service_coverage !== 'complete') {
      return [
        {
          check_key: `network.service:${serviceKey}`,
          control_key: 'A.8.21',
          service_key: serviceKey,
          status: 'not_evaluable' as const,
          severity: 'medium' as const,
          reason_code: 'technical_coverage_insufficient',
          explanation:
            'SIAM observed a network function, but the scan did not have enough coverage to verify it safely.',
          evidence: service,
        },
      ]
    }
    const rule = rules.find(
      candidate =>
        candidate.protocols.includes(service.protocol as 'tcp' | 'udp') &&
        candidate.ports.includes(service.port!) &&
        (!candidate.applies_to_asset_types ||
          (input.confirmed_type !== null &&
            candidate.applies_to_asset_types.includes(input.confirmed_type)))
    )
    if (!rule || (service.confidence ?? 0) < rule.minimum_confidence) {
      return [
        {
          check_key: `network.service:${serviceKey}`,
          control_key: 'A.8.21',
          service_key: serviceKey,
          status: 'not_evaluable' as const,
          severity: 'medium' as const,
          reason_code: rule ? 'service_confidence_insufficient' : 'service_unclassified',
          explanation:
            'SIAM found a network function but could not identify its purpose with enough confidence. Ask whoever maintains this device to review it.',
          evidence: service,
        },
      ]
    }
    const status =
      rule.classification === 'expected'
        ? 'compliant'
        : rule.classification === 'prohibited'
          ? 'non_compliant'
          : 'not_evaluable'
    return [
      {
        check_key: rule.key,
        control_key: rule.control_key,
        service_key: serviceKey,
        status,
        severity: rule.severity,
        reason_code: `network_${rule.classification}`,
        explanation: `${rule.message} ${rule.recommendation}`,
        evidence: service,
      },
    ]
  })
}
