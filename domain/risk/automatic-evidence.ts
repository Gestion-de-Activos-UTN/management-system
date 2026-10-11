import type { Criticality, Exposure, RiskSeverity } from './constants'

export type ServiceClassification = {
  classification: 'expected' | 'review' | 'prohibited' | 'unmatched'
  severity?: RiskSeverity
  confidence_ok?: boolean
}

const SEVERITY_RANK: readonly RiskSeverity[] = ['low', 'medium', 'high', 'critical']

// Highest declared rule severity; `unknown` (weight 2) only when no rule declares one.
const worstSeverity = (services: readonly ServiceClassification[]): RiskSeverity =>
  services.reduce<RiskSeverity>(
    (worst, item) =>
      item.severity &&
      item.severity !== 'unknown' &&
      (worst === 'unknown' || SEVERITY_RANK.indexOf(item.severity) > SEVERITY_RANK.indexOf(worst))
        ? item.severity
        : worst,
    'unknown'
  )

/** Plan §3.2.1, A.8.21: prohibited dominates; any review/unmatched/low-confidence → not evaluable. */
export function evaluateNetworkServices(input: {
  current: boolean
  complete: boolean
  services: readonly ServiceClassification[]
}): { efficacy: number | null; severity: RiskSeverity; reason_code: string } {
  if (!input.current || !input.complete)
    return { efficacy: null, severity: 'unknown', reason_code: 'scan_missing_or_incomplete' }
  const prohibited = input.services.filter(item => item.classification === 'prohibited')
  if (prohibited.length)
    return { efficacy: 0, severity: worstSeverity(prohibited), reason_code: 'network_prohibited' }
  if (
    input.services.some(
      item =>
        item.classification === 'review' ||
        item.classification === 'unmatched' ||
        item.confidence_ok === false
    )
  )
    return { efficacy: null, severity: 'unknown', reason_code: 'network_review_required' }
  return { efficacy: 1, severity: worstSeverity(input.services), reason_code: 'network_expected' }
}

export function exposureFromServices(input: {
  current: boolean
  complete: boolean
  services: readonly ServiceClassification[]
}): { exposure: Exposure; source: 'scan' | 'default_unknown' } {
  if (!input.current || !input.complete) return { exposure: 'medium', source: 'default_unknown' }
  if (input.services.some(item => item.classification === 'prohibited'))
    return { exposure: 'high', source: 'scan' }
  if (input.services.some(item => item.classification === 'review'))
    return { exposure: 'medium', source: 'scan' }
  return { exposure: 'low', source: 'scan' }
}

export function scopeMultiplier(
  assetCidr: string | null | undefined,
  unknownCidrs: ReadonlySet<string>
): 1 | 1.5 {
  return assetCidr && unknownCidrs.has(assetCidr) ? 1.5 : 1
}

export const inventoryEfficacy = (identified: boolean, hasOwner: boolean, authorization: string) =>
  identified && hasOwner && authorization === 'authorized' ? 1 : null

export const classificationEfficacy = (criticality: Criticality) =>
  criticality === 'unknown' ? null : 1

export const shadowItEfficacy = (identified: boolean, authorization: string) =>
  !identified || authorization === 'pending' ? null : authorization === 'authorized' ? 1 : 0

export function undeterminedExposureAlerts(
  assets: readonly {
    id: string
    cidr?: string | null
    identified: boolean
    criticality: Criticality
  }[]
) {
  const unknownCidrs = new Set(assets.filter(a => !a.identified && a.cidr).map(a => a.cidr!))
  return assets
    .filter(
      a =>
        a.identified &&
        ['high', 'critical'].includes(a.criticality) &&
        a.cidr &&
        unknownCidrs.has(a.cidr)
    )
    .map(a => ({ asset_id: a.id, cidr: a.cidr!, type: 'undetermined_exposure' as const }))
}
