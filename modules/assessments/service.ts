import { httpClient } from '@/lib/http-client'
import type { AssessmentAnswer, AssessmentInstance } from '@/app/types/payload-types'
import type { SaveAssessmentDraft, UpdateAssessmentPolicy } from './schema'
import type { EffectiveAnswer } from '@/domain/assessments/evaluateCompliance'

export type SecurityReviewSummary = {
  risk_score: number | null
  evaluated_percentage: number
  applicable_checks: number
  not_evaluable: number
  requires_attention: number
  excluded_assets: number
  risk_band: 'low' | 'medium' | 'high' | 'critical' | null
  unconfirmed_assets: number
}

export type AssessmentListResponse = { docs: AssessmentInstance[]; totalDocs: number }
export type AssessmentDetailResponse = {
  assessment: AssessmentInstance
  answers: AssessmentAnswer[]
  previous_answers?: AssessmentAnswer[]
  assessment_history?: AssessmentInstance[]
  effective_evidence: Record<string, EffectiveAnswer>
}

export function listAssessments(params?: {
  scope?: string
  officeId?: string | null
  assetId?: string
  asOrganization?: string
}) {
  return httpClient.get<AssessmentListResponse>('/api/v1/assessments', {
    scope: params?.scope,
    office_id: params?.officeId ?? undefined,
    asset_id: params?.assetId,
    asOrganization: params?.asOrganization,
  })
}

export function getSecurityReviewSummary(params?: {
  officeId?: string | null
  asOrganization?: string
}) {
  return httpClient.get<SecurityReviewSummary>('/api/v1/security-review/summary', {
    office_id: params?.officeId ?? undefined,
    asOrganization: params?.asOrganization,
  })
}

export function getAssessment(id: string, asOrganization?: string) {
  return httpClient.get<AssessmentDetailResponse>(`/api/v1/assessments/${id}`, { asOrganization })
}

export function saveAssessmentDraft(id: string, data: SaveAssessmentDraft) {
  return httpClient.patch(`/api/v1/assessments/${id}/draft`, data)
}

export function completeAssessment(id: string, data: SaveAssessmentDraft) {
  return httpClient.post<AssessmentInstance>(`/api/v1/assessments/${id}/complete`, data)
}

export function reopenAssessment(id: string, reason: string) {
  return httpClient.post<{ action: 'created' | 'preserved'; id?: string | number }>(
    `/api/v1/assessments/${id}/reopen`,
    { reason }
  )
}

export function updateAssessmentPolicy(data: UpdateAssessmentPolicy) {
  return httpClient.patch('/api/v1/organization/assessment-policy', data)
}
