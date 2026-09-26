import { httpClient } from '@/lib/http-client'
import type {
  ConfidenceBand,
  Criticality,
  Exposure,
  PairStatus,
  RiskBand,
  RiskSeverity,
} from '@/domain/risk/constants'
import type { AssetRiskScore, ControlAggregate } from '@/domain/risk/engine'
import type { RiskPolicyKey } from '@/domain/risk/catalog-v2/types'

export type RiskEvaluationDTO = {
  id: string
  evaluated_at: string
  engine_version: number
  catalog_version: number
  policy_key: RiskPolicyKey
  score: number | null
  base_band: RiskBand | null
  final_band: RiskBand | null
  coverage: number
  unknown_percentage: number
  confidence: ConfidenceBand
  effective_confidence: ConfidenceBand
  counts: Record<PairStatus | 'excluded' | 'excluded_assets' | 'unconfirmed_assets', number>
  alerts: {
    critical_assets: Array<{ asset_id: string; asset_label: string; control_key: string }>
    systemic_failures: string[]
    severe_concentration: boolean
    severe_concentration_percentage: number
    undetermined_exposure: Array<{ asset_id: string; asset_label: string; cidr: string }>
  }
  controls: ControlAggregate[]
  /** The assets with the highest residual risk, already labelled for display. */
  top_assets: Array<AssetRiskScore & { asset_label: string }>
}

export type RiskContributionDTO = {
  id: string
  asset_key: string
  asset_label: string
  control_key: string
  status: PairStatus
  criticality: Criticality
  severity: RiskSeverity
  exposure: Exposure
  exposure_source: 'scan' | 'default_unknown' | null
  scope_multiplier: number
  efficacy: number | null
  inherent_risk: number | null
  residual_risk: number | null
  excluded: boolean
  reason_code: string
}

export type LatestRiskResponse = {
  evaluation: RiskEvaluationDTO | null
  contributions: RiskContributionDTO[]
  pagination: { page: number; totalPages: number; totalDocs: number; hasNextPage: boolean }
}

export const getLatestRisk = (params?: {
  officeId?: string | null
  asOrganization?: string
  page?: number
}) =>
  httpClient.get<LatestRiskResponse>('/api/v1/risk/latest', {
    office_id: params?.officeId ?? undefined,
    page: params?.page ? String(params.page) : undefined,
    asOrganization: params?.asOrganization,
  })
