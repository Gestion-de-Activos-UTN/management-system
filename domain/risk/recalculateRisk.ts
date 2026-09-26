import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import type { Asset, ComplianceResult, NonNetworkAsset } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import { evaluateNetworkBaseline } from '@/domain/assessments/evaluateNetworkBaseline'
import { evaluateOfficeMonitoring } from '@/domain/assessments/evaluateAutomaticCompliance'
import { isAssetExcludedFromAssessments } from '@/domain/assessments/asset-assessment-scope'
import { RISK_POLICY_KEYS, type RiskPolicyKey } from './catalog-v2'
import type { Criticality } from './constants'
import { calculateRisk } from './engine'
import { persistRiskEvaluation } from './persistRiskEvaluation'
import { riskAssetTypeForManual, riskAssetTypeForScanned } from './risk-asset-type'
import type { ServiceClassification } from './automatic-evidence'
import {
  buildRiskPairs,
  type RiskAnswerEvidence,
  type RiskInputAsset,
  type RiskOfficeMonitoring,
} from './build-pairs'

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function networkAsset(doc: Asset, now: Date): RiskInputAsset {
  const coverage = doc.asset_coverage
  const classified: ServiceClassification[] = evaluateNetworkBaseline({
    confirmed_type: doc.confirmed_type ?? null,
    port_coverage: coverage?.port_scan ?? 'unknown',
    service_coverage: coverage?.service_detection ?? 'unknown',
    services: doc.services ?? [],
  }).map(row => ({
    classification:
      row.reason_code === 'network_prohibited'
        ? 'prohibited'
        : row.reason_code === 'network_expected'
          ? 'expected'
          : row.reason_code === 'network_review'
            ? 'review'
            : 'unmatched',
    severity: row.severity,
    confidence_ok: row.reason_code !== 'service_confidence_insufficient',
  }))
  return {
    key: `asset:${doc.id}`,
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
    network: {
      current: doc.status !== 'offline',
      complete: coverage?.port_scan === 'complete' && coverage?.service_detection === 'complete',
      services: classified,
    },
  }
}

function manualAsset(doc: NonNetworkAsset, now: Date): RiskInputAsset | null {
  const riskType = riskAssetTypeForManual(doc.asset_category)
  if (!riskType) return null
  return {
    key: `manual:${doc.id}`,
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
    network: null,
  }
}

function answerEvidence(row: ComplianceResult): RiskAnswerEvidence {
  const effect = asRecord(asRecord(row.evidence_snapshot).evaluation_effect)
  const efficacy = typeof effect.combined_efficacy === 'number' ? effect.combined_efficacy : null
  return {
    control_key: row.control_key,
    asset_key: row.asset
      ? `asset:${relationId(row.asset)}`
      : row.manual_asset
        ? `manual:${relationId(row.manual_asset)}`
        : null,
    office_id: row.office ? relationId(row.office) : null,
    efficacy: row.status === 'not_evaluable' ? null : efficacy,
    evaluated_at: row.evaluated_at,
    reason_code: row.reason_code,
  }
}

/** Loads current evidence, runs the pure engine and appends one auditable evaluation. */
export async function recalculateRisk(
  payload: Payload,
  input: { organizationId: string; officeId?: string; now?: Date },
  req?: PayloadRequest
) {
  const now = input.now ?? new Date()
  const organization = { organization: { equals: input.organizationId } }
  const scope: Where[] = input.officeId
    ? [organization, { office: { equals: input.officeId } }]
    : [organization]
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
    findAll<Asset>(payload, 'assets', { and: [...scope, notRetired] }, req),
    findAll<NonNetworkAsset>(payload, 'non-network-assets', { and: [...scope, notRetired] }, req),
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

  const { pairs, population, alerts } = buildRiskPairs({
    organizationId: input.organizationId,
    policy,
    assets,
    answers,
    monitoring,
  })
  const result = calculateRisk(pairs, population)
  return persistRiskEvaluation(
    payload,
    { ...input, policy, result, undeterminedExposure: alerts, evaluatedAt: now },
    req
  )
}
