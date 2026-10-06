import type { CollectionBeforeChangeHook, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import {
  assertAssessmentMutable,
  assertAssessmentTarget,
  type AssessmentStatus,
} from '../invariants'
import type { AssessmentScope } from '@/domain/assessments/catalog'

const optionalRelationId = (value: unknown): string | null => (value ? relationId(value) : null)

export const validateAssessmentInstance: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const merged = { ...originalDoc, ...data }
  const organizationId = optionalRelationId(merged.organization)
  const officeId = optionalRelationId(merged.office)
  const assetId = optionalRelationId(merged.asset)
  const manualAssetId = optionalRelationId(merged.manual_asset)
  const scope = merged.scope as AssessmentScope

  if (!organizationId) throw new Error('Assessment organization is required')
  assertAssessmentTarget(scope, officeId, assetId, manualAssetId)

  if (operation === 'update') {
    assertAssessmentMutable(originalDoc?.status as AssessmentStatus)
    for (const field of [
      'organization',
      'scope',
      'office',
      'asset',
      'manual_asset',
      'policy_key',
      'policy_version',
      'catalog_version',
    ] as const) {
      if (field in data && String(data[field] ?? '') !== String(originalDoc?.[field] ?? '')) {
        throw new Error(`Assessment field ${field} is immutable`)
      }
    }
  }

  if (officeId) {
    const office = await req.payload.findByID({
      collection: 'offices',
      id: officeId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (relationId(office.organization) !== organizationId)
      throw new Error('Assessment office belongs to another organization')
  }
  if (assetId) {
    const asset = await req.payload.findByID({
      collection: 'assets',
      id: assetId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (
      relationId(asset.organization) !== organizationId ||
      relationId(asset.office) !== officeId
    ) {
      throw new Error('Assessment asset does not belong to its organization and office')
    }
    // Reconciliation must be able to close an existing cycle after its target is retired.
    if (asset.status === 'retired' && merged.status !== 'superseded')
      throw new Error('Retired assets cannot receive assessment cycles')
  }
  if (manualAssetId) {
    const manualAsset = await req.payload.findByID({
      collection: 'non-network-assets',
      id: manualAssetId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (
      relationId(manualAsset.organization) !== organizationId ||
      relationId(manualAsset.office) !== officeId
    )
      throw new Error('Manual assessment asset belongs to another organization or office')
    if (
      (manualAsset.status === 'retired' || manualAsset.asset_category !== 'computer') &&
      merged.status !== 'superseded'
    )
      throw new Error('Only active manually entered computers can receive assessment cycles')
  }

  if (
    operation === 'create' &&
    ['pending', 'in_progress'].includes(String(merged.status ?? 'pending'))
  ) {
    const targetClauses: Where[] =
      scope === 'organization'
        ? [
            { office: { exists: false } },
            { asset: { exists: false } },
            { manual_asset: { exists: false } },
          ]
        : scope === 'office'
          ? [
              { office: { equals: officeId } },
              { asset: { exists: false } },
              { manual_asset: { exists: false } },
            ]
          : manualAssetId
            ? [{ asset: { exists: false } }, { manual_asset: { equals: manualAssetId } }]
            : [{ asset: { equals: assetId } }, { manual_asset: { exists: false } }]
    const existing = await req.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
      where: {
        and: [
          { organization: { equals: organizationId } },
          { scope: { equals: scope } },
          { policy_key: { equals: merged.policy_key } },
          { policy_version: { equals: merged.policy_version } },
          { status: { in: ['pending', 'in_progress'] } },
          ...targetClauses,
        ],
      },
    })
    if (existing.docs.length)
      throw new Error('An open assessment already exists for this policy and target')
  }
  return data
}
