import type { CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'

const optionalRelationId = (value: unknown): string | null => (value ? relationId(value) : null)

export const validateComplianceResult: CollectionBeforeChangeHook = async ({ data, req }) => {
  const organizationId = optionalRelationId(data?.organization)
  const officeId = optionalRelationId(data?.office)
  const assetId = optionalRelationId(data?.asset)
  const manualAssetId = optionalRelationId(data?.manual_asset)
  if (!organizationId) throw new Error('Compliance result organization is required')
  if (assetId && manualAssetId) throw new Error('A compliance result cannot target two assets')
  if ((assetId || manualAssetId) && !officeId)
    throw new Error('Asset compliance results require an office')
  if (data?.service_key && !assetId) throw new Error('Service compliance results require an asset')

  if (officeId) {
    const office = await req.payload.findByID({
      collection: 'offices',
      id: officeId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (relationId(office.organization) !== organizationId)
      throw new Error('Compliance result office belongs to another organization')
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
      throw new Error('Compliance result asset does not belong to its organization and office')
    }
  }
  if (manualAssetId) {
    const asset = await req.payload.findByID({
      collection: 'non-network-assets',
      id: manualAssetId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (
      relationId(asset.organization) !== organizationId ||
      relationId(asset.office) !== officeId
    ) {
      throw new Error('Manual compliance asset does not belong to its organization and office')
    }
    if (asset.asset_category !== 'computer')
      throw new Error('Only manually entered computers can receive assessment results')
  }
  if (data?.supersedes) {
    const previous = await req.payload.findByID({
      collection: 'compliance-results',
      id: relationId(data.supersedes),
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (relationId(previous.organization) !== organizationId)
      throw new Error('A compliance result cannot supersede another organization')
  }
  return data
}
