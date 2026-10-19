import type { CollectionBeforeChangeHook, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import {
  assertAssessmentMutable,
  assertAssessmentTarget,
  type AssessmentStatus,
} from '../invariants'
import type { AssessmentScope } from '@/domain/assessments/catalog'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

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
  // A target may already have moved. Closing its former cycle preserves the historical office;
  // new/open cycles must still match the target's current office.
  const closingHistoricalCycle = operation === 'update' && merged.status === 'superseded'

  if (!organizationId) throw new Error('La revisión debe pertenecer a una organización.')
  assertAssessmentTarget(scope, officeId, assetId, manualAssetId)

  if (operation === 'update') {
    if (req.context?.assessmentExpiryMaintenance && originalDoc?.status === 'completed' && Object.entries(data).every(([key, value]) => ['expiry_reconciled_at', 'updatedAt'].includes(key) || isDeepStrictEqual(value ?? null, originalDoc?.[key] ?? null))) return data
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
        throw new Error(`El campo ${field} de la revisión no se puede modificar.`)
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
        throw new Error('La oficina de la revisión pertenece a otra organización.')
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
      (!closingHistoricalCycle && relationId(asset.office) !== officeId)
    ) {
        throw new Error('El activo de la revisión no pertenece a su organización y oficina.')
    }
    // Reconciliation must be able to close an existing cycle after its target is retired.
    if (asset.status === 'retired' && merged.status !== 'superseded')
      throw new Error('Los activos dados de baja no pueden recibir ciclos de evaluación.')
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
      (!closingHistoricalCycle && relationId(manualAsset.office) !== officeId)
    )
        throw new Error('El activo manual de la revisión pertenece a otra organización u oficina.')
    if (
      (manualAsset.status === 'retired' || manualAsset.asset_category !== 'computer') &&
      merged.status !== 'superseded'
    )
      throw new Error('Solo las computadoras manuales activas pueden recibir ciclos de evaluación.')
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
      throw new Error('Ya existe una revisión abierta para esta política y este alcance.')
  }
  // A nullable unique column enforces one open cycle even when concurrent checks see none.
  // Closed cycles retain their history and release the key for the next review.
  const open = ['pending', 'in_progress'].includes(String(merged.status ?? 'pending'))
  return { ...data, open_cycle_key: open ? createHash('sha256').update(JSON.stringify([
    organizationId, scope, scope === 'organization' ? organizationId : scope === 'office' ? officeId : manualAssetId ?? assetId,
    manualAssetId ? 'manual' : 'network', merged.policy_key, merged.policy_version,
  ])).digest('hex') : null }
}
