import type { Criticality } from '@/domain/risk/constants'
import { httpClient } from '@/lib/http-client'
import type { ControlIndex, IndexBand, IndexVisibility } from '@/domain/risk/deficiency-index'
import type { EvaluationContext } from '@/domain/risk/deficiency-pairs'
import type { EvaluationCounts } from '@/domain/risk/evaluation-from-pairs'
import type { DeficiencyItem, PendingItem, ReasonView } from '@/domain/risk/risk-lists'
import type { RiskPolicyKey } from '@/domain/risk/catalog-v2/types'
import type { RecalculationStatus } from '@/domain/risk/recalculation-status'

/** Contracts §7. Index, band, D_c and asset indexes are null whenever `visibility` hides them. */
export type RiskEvaluationDTO = {
  id: string | null
  evaluated_at: string
  engine_version: number
  catalog_version: number
  policy_key: RiskPolicyKey
  index: number | null
  band: IndexBand | null
  coverage: number | null
  visibility: IndexVisibility
  /** Always present: coverage and warnings are shown even when the index is not. */
  controls: ControlIndex[]
  counts: EvaluationCounts
  context: EvaluationContext & { labels: Record<string, string> }
  top_assets: Array<{ asset_key: string; asset_label: string; index: number; band: IndexBand | null }>
}

export type Subject =
  | { kind: 'asset'; asset_key: string; asset_label: string; criticality: Criticality }
  | { kind: 'office' | 'organization'; id: string; label: string; affected_assets: number }

export type ReasonDTO = ReasonView

/** Deficiencias: priority medium or above; low reasons only appear inside an item's detail. */
export type DeficiencyItemDTO = Omit<DeficiencyItem, 'subject'> & { subject: Subject }
/** Pendientes: no priority; the survey block (A.5.12, A.5.9, A.8.16) comes first. */
export type PendingItemDTO = Omit<PendingItem, 'subject'> & { subject: Subject }

export type RiskList = 'deficiencies' | 'pending'

export type RiskScope = 'organization' | 'office' | 'assigned_offices'

export type LatestRiskResponse = {
  scope?: RiskScope
  recalculation?: RecalculationStatus
  evaluation: RiskEvaluationDTO | null
  /** Item count of each list over the whole evaluation, for the tab labels. */
  totals: Record<RiskList, number>
  pagination: { page: number; totalPages: number; totalDocs: number; hasNextPage: boolean }
} & (
  | { list: 'deficiencies'; items: DeficiencyItemDTO[] }
  | { list: 'pending'; items: PendingItemDTO[] }
)

export const getLatestRisk = (params?: {
  evaluationId?: string
  officeId?: string | null
  asOrganization?: string
  page?: number
  limit?: number
  list?: RiskList
}) =>
  httpClient.get<LatestRiskResponse>('/api/v1/risk/latest', {
    office_id: params?.officeId ?? undefined,
    evaluation_id: params?.evaluationId,
    page: params?.page ? String(params.page) : undefined,
    limit: params?.limit ? String(params.limit) : undefined,
    list: params?.list,
    asOrganization: params?.asOrganization,
  })
