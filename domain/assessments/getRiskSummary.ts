import type { Payload, PayloadRequest, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { POLICY_CATALOG, QUESTION_CATALOG, type PolicyKey } from './catalog'
import { computeRiskSummary, type RiskCheck, type RiskSummary } from './computeRiskSummary'

type RiskSummaryScope = { organizationId: string; officeId?: string; now?: Date }

const targetKey = (row: { office?: unknown; asset?: unknown; manual_asset?: unknown }) =>
  row.manual_asset
    ? `manual_asset:${relationId(row.manual_asset)}`
    : row.asset
      ? `asset:${relationId(row.asset)}`
      : row.office
        ? `office:${relationId(row.office)}`
        : 'organization'

export type RiskSummaryEvidence = { checks: RiskCheck[]; result_ids: Array<string | number> }

export async function getRiskSummary(
  payload: Payload,
  scope: RiskSummaryScope,
  req?: PayloadRequest
): Promise<{ summary: RiskSummary; evidence: RiskSummaryEvidence }> {
  const now = scope.now ?? new Date()
  const settingsResult = await payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: scope.organizationId } },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 1,
  })
  const settings = settingsResult.docs[0]
  const policy = POLICY_CATALOG.find(
    candidate =>
      candidate.key === (settings?.assessment_policy_key as PolicyKey) &&
      candidate.version === settings?.assessment_policy_version
  )
  if (!policy) throw new Error('Assessment policy is unavailable for risk calculation')

  const assetWhere: Where = {
    and: [
      { organization: { equals: scope.organizationId } },
      ...(scope.officeId ? [{ office: { equals: scope.officeId } }] : []),
      { status: { not_equals: 'retired' } },
    ],
  }
  const assets = await payload.find({
    collection: 'assets',
    where: assetWhere,
    overrideAccess: true,
    req,
    depth: 0,
    limit: 5000,
  })
  const manualAssets = await payload.find({
    collection: 'non-network-assets',
    where: {
      and: [
        { organization: { equals: scope.organizationId } },
        ...(scope.officeId ? [{ office: { equals: scope.officeId } }] : []),
        { asset_category: { equals: 'computer' } },
        { status: { not_equals: 'retired' } },
      ],
    },
    overrideAccess: true,
    req,
    depth: 0,
    limit: 5000,
  })
  const assetById = new Map(assets.docs.map(asset => [String(asset.id), asset]))
  const manualAssetById = new Map(manualAssets.docs.map(asset => [String(asset.id), asset]))
  const assetIds = [...assetById.keys()]
  const manualAssetIds = [...manualAssetById.keys()]
  const officeIds = scope.officeId
    ? [scope.officeId]
    : (
        await payload.find({
          collection: 'offices',
          where: { organization: { equals: scope.organizationId } },
          overrideAccess: true,
          req,
          depth: 0,
          limit: 5000,
        })
      ).docs.map(office => String(office.id))
  const resultScope: Where = scope.officeId
    ? {
        or: [
          {
            and: [
              { office: { equals: scope.officeId } },
              { asset: { exists: false } },
              { manual_asset: { exists: false } },
            ],
          },
          {
            and: [
              { office: { exists: false } },
              { asset: { exists: false } },
              { manual_asset: { exists: false } },
            ],
          },
          ...(assetIds.length ? [{ asset: { in: assetIds } }] : []),
          ...(manualAssetIds.length ? [{ manual_asset: { in: manualAssetIds } }] : []),
        ],
      }
    : { organization: { equals: scope.organizationId } }
  const assessmentScope: Where = scope.officeId
    ? {
        or: [
          { scope: { equals: 'organization' } },
          {
            and: [{ scope: { equals: 'office' } }, { office: { equals: scope.officeId } }],
          },
          ...(assetIds.length ? [{ asset: { in: assetIds } }] : []),
          ...(manualAssetIds.length ? [{ manual_asset: { in: manualAssetIds } }] : []),
        ],
      }
    : { organization: { equals: scope.organizationId } }

  const [results, assessments, scans] = await Promise.all([
    payload.find({
      collection: 'compliance-results',
      where: {
        and: [
          { organization: { equals: scope.organizationId } },
          { policy_key: { equals: policy.key } },
          { policy_version: { equals: policy.version } },
          resultScope,
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
      sort: '-evaluated_at',
    }),
    payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { organization: { equals: scope.organizationId } },
          { policy_key: { equals: policy.key } },
          { policy_version: { equals: policy.version } },
          { status: { not_equals: 'superseded' } },
          assessmentScope,
        ],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 5000,
      sort: '-createdAt',
    }),
    payload.find({
      collection: 'scan-reports',
      where: {
        and: [{ office: { in: officeIds } }, { status: { equals: 'processed' } }],
      },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
      sort: '-processed_at',
    }),
  ])

  const checks = new Map<string, RiskCheck>()
  const resultIds: Array<string | number> = []
  for (const result of results.docs) {
    const assetId = result.asset ? relationId(result.asset) : null
    const manualAssetId = result.manual_asset ? relationId(result.manual_asset) : null
    if (assetId && !assetById.has(assetId)) continue
    if (manualAssetId && !manualAssetById.has(manualAssetId)) continue
    const key = `${result.check_key}:${targetKey(result)}`
    if (checks.has(key)) continue
    const asset = assetId ? assetById.get(assetId) : null
    const manualAsset = manualAssetId ? manualAssetById.get(manualAssetId) : null
    checks.set(key, {
      key,
      control_key: result.control_key,
      status: Date.parse(result.valid_until) > now.getTime() ? result.status : 'not_evaluable',
      severity: result.severity,
      criticality: asset?.criticality ?? manualAsset?.criticality ?? null,
    })
    resultIds.push(result.id)
  }

  const seenAssessmentTargets = new Set<string>()
  for (const assessment of assessments.docs) {
    const target = targetKey(assessment)
    if (assessment.asset && !assetById.has(relationId(assessment.asset))) continue
    if (assessment.manual_asset && !manualAssetById.has(relationId(assessment.manual_asset)))
      continue
    if (seenAssessmentTargets.has(target)) continue
    seenAssessmentTargets.add(target)
    const snapshot = Array.isArray(assessment.question_set_snapshot)
      ? assessment.question_set_snapshot
      : []
    for (const item of snapshot) {
      if (!item || typeof item !== 'object' || !('key' in item) || !('version' in item)) continue
      const questionKey = String(item.key)
      const key = `manual:${questionKey}:${target}`
      if (checks.has(key)) continue
      const definition = QUESTION_CATALOG.find(
        question => question.key === questionKey && question.version === Number(item.version)
      )
      checks.set(key, {
        key,
        control_key: definition?.control_keys[0] ?? 'unknown',
        status: 'not_evaluable',
        severity: 'medium',
        criticality: assessment.asset
          ? (assetById.get(relationId(assessment.asset))?.criticality ?? null)
          : assessment.manual_asset
            ? (manualAssetById.get(relationId(assessment.manual_asset))?.criticality ?? null)
            : null,
      })
    }
  }

  const checkRows = [...checks.values()]
  return {
    summary: computeRiskSummary(checkRows, policy, {
      pendingAssetIdentifications: assets.docs.filter(asset => !asset.identified).length,
      lastValidScanAt: scans.docs[0]?.processed_at ?? null,
    }),
    evidence: { checks: checkRows, result_ids: resultIds },
  }
}
