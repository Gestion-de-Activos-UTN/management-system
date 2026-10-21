import type { CollectionBeforeChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import { isManualCategoryAssessable } from '@/domain/risk/risk-asset-type'

const optionalRelationId = (value: unknown): string | null => (value ? relationId(value) : null)

export const validateComplianceResult: CollectionBeforeChangeHook = async ({ data, req }) => {
  const organizationId = optionalRelationId(data?.organization)
  const officeId = optionalRelationId(data?.office)
  const assetId = optionalRelationId(data?.asset)
  const manualAssetId = optionalRelationId(data?.manual_asset)
  if (!organizationId)
    throw new Error('El resultado de cumplimiento debe pertenecer a una organización.')
  if (assetId && manualAssetId)
    throw new Error('Un resultado de cumplimiento no puede corresponder a dos activos.')
  if ((assetId || manualAssetId) && !officeId)
    throw new Error('Los resultados de cumplimiento de activos requieren una oficina.')
  if (data?.service_key && !assetId)
    throw new Error('Los resultados de servicios requieren un activo.')

  if (officeId) {
    const office = await req.payload.findByID({
      collection: 'offices',
      id: officeId,
      overrideAccess: true,
      req,
      depth: 0,
    })
    if (relationId(office.organization) !== organizationId)
      throw new Error('La oficina del resultado de cumplimiento pertenece a otra organización.')
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
      throw new Error('El activo del resultado de cumplimiento no pertenece a su organización y oficina.')
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
      throw new Error('El activo manual de cumplimiento no pertenece a su organización y oficina.')
    }
    if (asset.asset_category !== 'computer')
      throw new Error('Solo las computadoras manuales pueden recibir resultados de evaluación.')
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
      throw new Error('Un resultado de cumplimiento no puede reemplazar el de otra organización.')
  }
  return data
}
