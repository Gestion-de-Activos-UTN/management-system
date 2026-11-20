import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import type { Asset, ComplianceResult, NonNetworkAsset } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import { findActiveOffices } from '@/domain/offices/active-offices'
import { evaluateOfficeMonitoring } from '@/domain/assessments/evaluateAutomaticCompliance'
import { isAssetExcludedFromAssessments } from '@/domain/assessments/asset-assessment-scope'
import { RISK_POLICY_KEYS, type RiskPolicyKey } from './catalog-v2'
import type { Criticality } from './constants'
import { persistRiskEvaluation } from './persistRiskEvaluation'
import { riskAssetTypeForManual, riskAssetTypeForScanned } from './risk-asset-type'
import { answerEvidence, assetKey, type AnswerEvidence } from './answer-evidence'
import { networkHistoryRow, networkObservation, type NetworkHistoryRow } from './network-evidence'
import {
  buildDeficiencyPairs,
  type RiskInputAsset,
  type RiskOfficeMonitoring,
} from './deficiency-pairs'
import { evaluationFromPairs } from './evaluation-from-pairs'

const criticality = (value: string | null | undefined): Criticality =>
  value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
    ? value
    : 'unknown'

// Pages through the whole result set: a silent truncation would drop pairs from coverage.
async function findAll<T>(
  payload: Payload,
  collection: CollectionSlug,
  where: Where,
  req?: PayloadRequest
): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page += 1) {
    const result = await payload.find({
      collection,
      where,
      overrideAccess: true,
      req,
      depth: 0,
      limit: 200,
      page,
    })
    docs.push(...(result.docs as T[]))
    if (!result.hasNextPage) return docs
  }
}

function networkAsset(doc: Asset, now: Date): RiskInputAsset {
  return {
    key: assetKey({ asset: doc.id })!,
    source: 'network',
    office_id: relationId(doc.office),
    risk_type:
      doc.identified && doc.confirmed_type ? riskAssetTypeForScanned(doc.confirmed_type) : null,
    criticality: criticality(doc.criticality),
    identified: Boolean(doc.identified),
    authorization_status: doc.authorization_status ?? 'pending',
    has_owner: Boolean(doc.owner),
    cidr: doc.last_observed_cidr ?? null,
    excluded: isAssetExcludedFromAssessments(doc, now),
    observation: networkObservation(doc),
  }
}

function manualAsset(doc: NonNetworkAsset, now: Date): RiskInputAsset | null {
  const riskType = riskAssetTypeForManual(doc.asset_category)
  if (!riskType) return null
  return {
    key: assetKey({ manual_asset: doc.id })!,
    source: 'manual',
    office_id: relationId(doc.office),
    risk_type: riskType,
    criticality: criticality(doc.criticality),
    // Registered by an authorized user, so identity and authorization are human-confirmed.
    identified: true,
    authorization_status: 'authorized',
    has_owner: Boolean(doc.owner),
    cidr: null,
    excluded: isAssetExcludedFromAssessments(doc, now),
    observation: null,
  }
}

type RiskScopeInput = {
  organizationId: string
  officeId?: string
  officeIds?: readonly string[]
  now?: Date
}

/** Reads the current evidence of a scope once, for persisted evaluations, consolidations and simulations. */
export async function loadRiskInputs(
  payload: Payload,
  input: RiskScopeInput,
  req?: PayloadRequest
): Promise<{
  policy: RiskPolicyKey
  assets: RiskInputAsset[]
  answers: AnswerEvidence[]
  monitoring: RiskOfficeMonitoring[]
  networkHistory: NetworkHistoryRow[]
  officeIds: string[]
  evaluatedAt: Date
}> {
  if (input.officeId && input.officeIds) throw new Error('Choose one office scope')
  const now = input.now ?? new Date()
  const organization = { organization: { equals: input.organizationId } }
  // Inactive offices never count: their assets left the organization's exposure.
  const activeOfficeIds = (await findActiveOffices(payload, input.organizationId, req))
    .map(office => String(office.id))
    .filter(
      id =>
        (!input.officeId || id === input.officeId) &&
        (input.officeIds === undefined || input.officeIds.includes(id))
    )
  const scope: Where[] = [organization, { office: { in: activeOfficeIds } }]
  const notRetired = { status: { not_equals: 'retired' } }

  const [settings, networkDocs, manualDocs, results] = await Promise.all([
    payload.find({
      collection: 'organization-settings',
      where: organization,
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    activeOfficeIds.length
      ? findAll<Asset>(payload, 'assets', { and: [...scope, notRetired] }, req)
      : Promise.resolve([] as Asset[]),
    activeOfficeIds.length
      ? findAll<NonNetworkAsset>(
          payload,
          'non-network-assets',
          { and: [...scope, notRetired] },
          req
        )
      : Promise.resolve([] as NonNetworkAsset[]),
    // Organization-wide on purpose: an office evaluation still inherits organization answers.
    // Only current answers are loaded; expired ones leave the pair not evaluable (aging, §3.10).
    findAll<ComplianceResult>(
      payload,
      'compliance-results',
      { and: [organization, { valid_until: { greater_than: now.toISOString() } }] },
      req
    ),
  ])
  const policyKey = settings.docs[0]?.assessment_policy_key
  const policy: RiskPolicyKey = RISK_POLICY_KEYS.find(key => key === policyKey) ?? 'essential'

  const assets = [
    ...networkDocs.map(doc => networkAsset(doc, now)),
    ...manualDocs.flatMap(doc => manualAsset(doc, now) ?? []),
  ]
  const officeIds = [...new Set(networkDocs.map(doc => relationId(doc.office)))]
  const monitoring: RiskOfficeMonitoring[] = await Promise.all(
    officeIds.map(async officeId => {
      const agents = await findAll<Parameters<typeof evaluateOfficeMonitoring>[0][number]>(
        payload,
        'agents',
        { office: { equals: officeId } },
        req
      )
      const check = evaluateOfficeMonitoring(agents, now)
      return {
        office_id: officeId,
        efficacy: check.status === 'compliant' ? 1 : check.status === 'non_compliant' ? 0 : null,
        reason_code: check.reason_code,
      }
    })
  )
  // Human answers only; automatic controls are derived here from current evidence. Answers given
  // under another policy combine a different question set, so they never feed the current one.
  const answers = results
    .filter(row => row.check_key.startsWith('manual:') && row.policy_key === policy)
    .map(answerEvidence)
  // D26 context: one paginated read of the confirmed A.8.21 history of the scope, never one per
  // port. valid_until is ignored on purpose: an expired finding can still be the antecedent.
  // ponytail: reads the whole A.8.21 history of the scope; mark the logical head or window it if it grows.
  const networkHistory = networkDocs.length
    ? (
        await findAll<ComplianceResult>(
          payload,
          'compliance-results',
          {
            and: [
              organization,
              { control_key: { equals: 'A.8.21' } },
              { service_key: { exists: true } },
              { asset: { in: networkDocs.map(doc => doc.id) } },
              { status: { in: ['compliant', 'non_compliant'] } },
            ],
          },
          req
        )
      ).map(networkHistoryRow)
    : []
  return {
    policy,
    assets,
    answers,
    monitoring,
    networkHistory,
    officeIds: activeOfficeIds,
    evaluatedAt: now,
  }
}

/** Read-only calculation shared by persisted evaluations and assigned-office consolidations. */
export async function calculateRiskForScope(
  payload: Payload,
  input: RiskScopeInput,
  req?: PayloadRequest
) {
  const { policy, assets, answers, monitoring, networkHistory, officeIds, evaluatedAt } =
    await loadRiskInputs(payload, input, req)
  const { pairs, assetCounts, context } = buildDeficiencyPairs({
    organizationId: input.organizationId,
    policy,
    assets,
    answers,
    monitoring,
    networkHistory,
  })
  const evaluation = evaluationFromPairs({ policy, pairs, assetCounts, context })
  return { policy, evaluation, pairs, evaluatedAt, officeIds }
}

/** Loads current evidence, runs the pure engine and appends one auditable evaluation. */
export async function recalculateRisk(
  payload: Payload,
  input: { organizationId: string; officeId?: string; now?: Date },
  req?: PayloadRequest
) {
  const calculated = await calculateRiskForScope(payload, input, req)
  return persistRiskEvaluation(payload, { ...input, ...calculated }, req)
}
