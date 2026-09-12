import type { Payload, PayloadRequest } from 'payload'
import type { Agent, Asset, AssessmentInstance } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import { isAgentOnline } from '@/domain/agents/agent-state'
import { evaluateNetworkBaseline, type NetworkEvaluation } from './evaluateNetworkBaseline'
import type { ComplianceStatus, PolicyKey } from './catalog'
import type { CheckEvaluation } from './evaluateCompliance'
import { isAssetExcludedFromAssessments } from './asset-assessment-scope'

type AutomaticCheck = CheckEvaluation & {
  control_key: string
  check_key: string
  service_key?: string
  evidence: unknown
}

export function evaluateAssetFacts(
  asset: Pick<Asset, 'identified' | 'owner' | 'criticality' | 'authorization_status'>
): AutomaticCheck[] {
  const inventoryComplete = Boolean(
    asset.identified &&
    asset.owner &&
    asset.criticality &&
    asset.authorization_status &&
    asset.authorization_status !== 'pending'
  )
  const authorizationStatus: ComplianceStatus =
    asset.authorization_status === 'authorized'
      ? 'compliant'
      : asset.authorization_status === 'unauthorized'
        ? 'non_compliant'
        : 'not_evaluable'
  return [
    {
      control_key: 'A.5.9',
      check_key: 'asset.inventory.complete',
      status: inventoryComplete ? 'compliant' : 'not_evaluable',
      severity: 'medium',
      reason_code: inventoryComplete ? 'inventory_fields_current' : 'inventory_fields_missing',
      explanation: inventoryComplete
        ? 'This device is identified and has the basic business details needed to manage it.'
        : 'SIAM needs the device owner, importance and authorization status before it can evaluate the inventory record.',
      evidence: {
        identified: asset.identified,
        owner: Boolean(asset.owner),
        criticality: asset.criticality,
        authorization_status: asset.authorization_status,
      },
    },
    {
      control_key: 'A.5.12',
      check_key: 'asset.classification.present',
      status: asset.criticality ? 'compliant' : 'not_evaluable',
      severity: 'medium',
      reason_code: asset.criticality ? 'criticality_recorded' : 'criticality_missing',
      explanation: asset.criticality
        ? 'The importance of this device to the business is recorded.'
        : 'The importance of this device has not been confirmed yet.',
      evidence: { criticality: asset.criticality },
    },
    {
      control_key: 'A.8.20',
      check_key: 'asset.authorization.status',
      status: authorizationStatus,
      severity: 'high',
      reason_code:
        authorizationStatus === 'compliant'
          ? 'asset_authorized'
          : authorizationStatus === 'non_compliant'
            ? 'asset_unauthorized'
            : 'authorization_unknown',
      explanation:
        authorizationStatus === 'compliant'
          ? 'The company recognizes and authorizes this device.'
          : authorizationStatus === 'non_compliant'
            ? 'The company marked this device as unauthorized and it requires attention.'
            : 'The company has not confirmed whether this device is authorized.',
      evidence: { authorization_status: asset.authorization_status },
    },
  ]
}

export function evaluateOfficeMonitoring(
  agents: readonly Pick<Agent, 'id' | 'last_heartbeat_at' | 'lifecycle_status'>[],
  now: Date
): AutomaticCheck {
  const activeAgents = agents.filter(agent => agent.lifecycle_status !== 'revoked')
  const online = activeAgents.some(agent => isAgentOnline(agent, now))
  const status: ComplianceStatus = !activeAgents.length
    ? 'not_evaluable'
    : online
      ? 'compliant'
      : 'non_compliant'
  return {
    control_key: 'A.8.16',
    check_key: 'office.monitoring.active',
    status,
    severity: 'high',
    reason_code: !activeAgents.length
      ? 'agent_missing'
      : online
        ? 'agent_reporting'
        : 'agent_not_reporting',
    explanation: !activeAgents.length
      ? 'SIAM cannot verify monitoring because this office has no active scanner.'
      : online
        ? 'The office scanner is reporting normally.'
        : 'The office scanner has stopped reporting and monitoring requires attention.',
    evidence: {
      agents: activeAgents.map(agent => ({
        id: agent.id,
        last_heartbeat_at: agent.last_heartbeat_at,
      })),
    },
  }
}

const TECHNICAL_VALIDITY_DAYS = 30

async function persistResult(
  payload: Payload,
  assessment: AssessmentInstance,
  check: AutomaticCheck | NetworkEvaluation,
  evaluatedAt: string,
  req?: PayloadRequest
) {
  const organizationId = relationId(assessment.organization)
  const officeId = assessment.office ? relationId(assessment.office) : null
  const assetId = assessment.asset ? relationId(assessment.asset) : null
  const prior = await payload.find({
    collection: 'compliance-results',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
    sort: '-evaluated_at',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { check_key: { equals: check.check_key } },
        officeId ? { office: { equals: officeId } } : { office: { exists: false } },
        assetId ? { asset: { equals: assetId } } : { asset: { exists: false } },
        'service_key' in check && check.service_key
          ? { service_key: { equals: check.service_key } }
          : { service_key: { exists: false } },
      ],
    },
  })
  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {automatic compliance result}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    req,
    data: {
      organization: organizationId,
      office: officeId,
      asset: assetId,
      service_key: 'service_key' in check ? check.service_key : null,
      control_key: check.control_key,
      check_key: check.check_key,
      status: check.status,
      severity: check.severity,
      policy_key: assessment.policy_key as PolicyKey,
      policy_version: assessment.policy_version,
      evaluated_at: evaluatedAt,
      valid_until: new Date(
        Date.parse(evaluatedAt) + TECHNICAL_VALIDITY_DAYS * 86400000
      ).toISOString(),
      reason_code: check.reason_code,
      explanation: check.explanation,
      evidence_snapshot: check.evidence as unknown as { [key: string]: unknown },
      supersedes: prior.docs[0]?.id ?? null,
    },
  })
}

export async function evaluateAutomaticComplianceForAssessment(
  payload: Payload,
  assessment: AssessmentInstance,
  req?: PayloadRequest,
  now = new Date()
): Promise<void> {
  const checks: Array<AutomaticCheck | NetworkEvaluation> = []
  if (assessment.scope === 'asset' && assessment.asset) {
    const asset = await payload.findByID({
      collection: 'assets',
      id: relationId(assessment.asset),
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (asset.status !== 'retired' && !isAssetExcludedFromAssessments(asset, now)) {
      checks.push(...evaluateAssetFacts(asset))
      const networkChecks = evaluateNetworkBaseline({
        confirmed_type: asset.confirmed_type ?? null,
        port_coverage: asset.asset_coverage?.port_scan ?? 'unknown',
        service_coverage: asset.asset_coverage?.service_detection ?? 'unknown',
        services: asset.services ?? [],
      })
      checks.push(...networkChecks)
      if (
        asset.asset_coverage?.port_scan === 'complete' &&
        asset.asset_coverage?.service_detection === 'complete'
      ) {
        const currentKeys = new Set(networkChecks.map(check => check.service_key))
        const previous = await payload.find({
          collection: 'compliance-results',
          overrideAccess: true,
          req,
          depth: 0,
          limit: 500,
          sort: '-evaluated_at',
          where: { and: [{ asset: { equals: asset.id } }, { service_key: { exists: true } }] },
        })
        const seen = new Set<string>()
        for (const result of previous.docs) {
          if (!result.service_key || seen.has(result.service_key)) continue
          seen.add(result.service_key)
          if (!currentKeys.has(result.service_key) && result.status !== 'compliant') {
            checks.push({
              control_key: result.control_key,
              check_key: result.check_key,
              service_key: result.service_key,
              status: 'compliant',
              severity: result.severity,
              reason_code: 'service_no_longer_observed',
              explanation: 'A complete scan no longer found this network function on the device.',
              evidence: { previous_result_id: result.id, coverage: 'complete' },
            })
          }
        }
      }
    }
  }
  if (assessment.scope === 'office' && assessment.office) {
    const agents = await payload.find({
      collection: 'agents',
      where: { office: { equals: relationId(assessment.office) } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 100,
    })
    checks.push(evaluateOfficeMonitoring(agents.docs, now))
  }
  for (const check of checks)
    await persistResult(payload, assessment, check, now.toISOString(), req)
}

export async function reevaluateComplianceAfterScan(
  payload: Payload,
  organizationId: string,
  officeId: string,
  assetIds: readonly string[],
  req?: PayloadRequest,
  now = new Date()
): Promise<void> {
  const [settingsResult, subscriptionResult] = await Promise.all([
    payload.find({
      collection: 'organization-settings',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
    payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: organizationId } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    }),
  ])
  const settings = settingsResult.docs[0]
  const featureValue = subscriptionResult.docs[0]?.features
  const features =
    featureValue && typeof featureValue === 'object' && !Array.isArray(featureValue)
      ? featureValue
      : null
  if (!settings || features?.security_assessments !== true) return
  const targets = await payload.find({
    collection: 'assessment-instances',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 500,
    sort: '-createdAt',
    where: {
      and: [
        { organization: { equals: organizationId } },
        { policy_key: { equals: settings.assessment_policy_key } },
        { policy_version: { equals: settings.assessment_policy_version } },
        {
          or: [
            { office: { equals: officeId }, scope: { equals: 'office' } },
            { asset: { in: [...assetIds] }, scope: { equals: 'asset' } },
          ],
        },
      ],
    },
  })
  const latestByTarget = new Map<string, AssessmentInstance>()
  for (const assessment of targets.docs) {
    const key =
      assessment.scope === 'office' ? `office:${officeId}` : `asset:${relationId(assessment.asset)}`
    if (!latestByTarget.has(key)) latestByTarget.set(key, assessment)
  }
  const representedAssets = new Set(
    [...latestByTarget.values()].flatMap(assessment =>
      assessment.scope === 'asset' && assessment.asset ? [relationId(assessment.asset)] : []
    )
  )
  for (const assetId of assetIds) {
    if (representedAssets.has(assetId)) continue
    latestByTarget.set(`asset:${assetId}`, {
      id: `automatic:${assetId}`,
      organization: organizationId,
      office: officeId,
      asset: assetId,
      scope: 'asset',
      policy_key: settings.assessment_policy_key,
      policy_version: settings.assessment_policy_version,
      catalog_version: 1,
      question_set_snapshot: [],
      status: 'completed',
      created_reason: 'initial',
      opened_at: now.toISOString(),
      due_at: now.toISOString(),
      completion_summary: { compliant: 0, non_compliant: 0, not_evaluable: 0 },
      updatedAt: now.toISOString(),
      createdAt: now.toISOString(),
    })
  }
  for (const assessment of latestByTarget.values()) {
    await evaluateAutomaticComplianceForAssessment(payload, assessment, req, now)
  }
}
