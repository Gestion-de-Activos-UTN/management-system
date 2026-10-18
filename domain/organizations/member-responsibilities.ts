import type { PayloadRequest, Where } from 'payload'
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import { withSystemContext } from '@/lib/system-context'
import { lockAssetRow } from '@/domain/with-transaction'

export type MemberCoverage = { isActive: boolean; orgWide: boolean; officeIds: string[] }

/**
 * Qué oficinas dejó de cubrir una persona entre dos estados de su membership: 'all' si se
 * desactivó, o la lista de oficinas activas que perdió. Las inactivas se ignoran: ya no cuentan,
 * y updateMember las descarta en silencio (degradar a un org_admin parecería perderlas).
 */
export function lostCoverage(
  previous: MemberCoverage,
  next: MemberCoverage,
  activeOfficeIds: readonly string[]
): 'all' | string[] {
  if (!previous.isActive) return []
  if (!next.isActive) return 'all'
  const active = new Set(activeOfficeIds)
  const covered = (coverage: MemberCoverage) =>
    coverage.orgWide ? [...active] : coverage.officeIds.filter(id => active.has(id))
  const kept = new Set(covered(next))
  return covered(previous).filter(id => !kept.has(id))
}

const ASSET_COLLECTIONS = ['assets', 'non-network-assets'] as const
type AssetCollection = (typeof ASSET_COLLECTIONS)[number]

async function ownedAssets(
  req: PayloadRequest,
  organizationId: string,
  userId: string,
  offices: 'all' | string[]
) {
  const where: Where = {
    and: [
      { organization: { equals: organizationId } },
      { owner: { equals: userId } },
      { deleted_at: { exists: false } },
      ...(offices === 'all' ? [] : [{ office: { in: offices } }]),
    ],
  }
  const results = await Promise.all(
    ASSET_COLLECTIONS.map(collection =>
      req.payload.find({
        collection,
        where,
        overrideAccess: true,
        req,
        depth: 0,
        pagination: false,
      })
    )
  )
  return [
    ...(results[0].docs as Asset[]).map(doc => ({ collection: 'assets' as const, doc })),
    ...(results[1].docs as NonNetworkAsset[]).map(doc => ({
      collection: 'non-network-assets' as const,
      doc,
    })),
  ]
}

async function writeOwner(
  req: PayloadRequest,
  collection: AssetCollection,
  id: string,
  owner: string | null
) {
  await lockAssetRow(req, collection, id)
  // AUDIT: this action must emit an AuditLogs entry (asset owner {released|reassigned} by member lifecycle, chain_hash over {asset, previous owner, owner}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  // NOTIFY: this event should trigger a Notification Bell entry for {new owner, org_admins of this organization}
  // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
  // Sólo `owner`: un activo de red no identificado rechaza cualquier otro campo de negocio.
  await req.payload.update({ collection, id, data: { owner }, overrideAccess: true, req })
}

const releaseOwner = (req: PayloadRequest, collection: AssetCollection, id: string) =>
  withSystemContext(req, 'systemOwnerRelease', () => writeOwner(req, collection, id, null))

/**
 * Deja sin responsable los activos de una persona en las oficinas que dejó de cubrir. Los hooks
 * de los activos sincronizan el assigned_to de sus assessments y encolan el riesgo.
 */
export async function releaseOwnedAssets(
  req: PayloadRequest,
  organizationId: string,
  userId: string,
  offices: 'all' | string[]
): Promise<void> {
  if (Array.isArray(offices) && !offices.length) return
  // ponytail: uno por uno para que corran los hooks de cada activo; por lotes si llega a medirse lento.
  for (const { collection, doc } of await ownedAssets(req, organizationId, userId, offices)) {
    await releaseOwner(req, collection, String(doc.id))
  }
}

/**
 * Pasa los activos de una persona a un reemplazo. Sólo los vigentes, identificados (red) y de
 * oficinas activas cambian de responsable; los demás no admiten un responsable nuevo (retirados,
 * no identificados, de oficinas que ya no cuentan) y quedan sin responsable.
 */
export async function reassignOwnedAssets(
  req: PayloadRequest,
  organizationId: string,
  fromUserId: string,
  toUserId: string
): Promise<void> {
  const activeOffices = await req.payload.find({
    collection: 'offices',
    where: {
      and: [{ organization: { equals: organizationId } }, { is_active: { equals: true } }],
    },
    overrideAccess: true,
    req,
    depth: 0,
    pagination: false,
    select: {},
  })
  const active = new Set(activeOffices.docs.map(office => String(office.id)))
  for (const { collection, doc } of await ownedAssets(req, organizationId, fromUserId, 'all')) {
    const identified =
      collection === 'non-network-assets' || doc.identification_status === 'confirmed'
    const assignable = doc.status !== 'retired' && active.has(relationId(doc.office)) && identified
    // Los hooks validan que el reemplazo cubra la oficina del activo; si no, todo hace rollback.
    if (assignable) await writeOwner(req, collection, String(doc.id), toUserId)
    else await releaseOwner(req, collection, String(doc.id))
  }
}

/** Activos a cargo de una persona, para el cuadro de desactivación. */
export async function ownedAssetsSummary(
  req: PayloadRequest,
  organizationId: string,
  userId: string
) {
  const owned = await ownedAssets(req, organizationId, userId, 'all')
  const officeIds = [...new Set(owned.map(({ doc }) => relationId(doc.office)))]
  const offices = officeIds.length
    ? await req.payload.find({
        collection: 'offices',
        where: { id: { in: officeIds } },
        overrideAccess: true,
        req,
        depth: 0,
        pagination: false,
      })
    : { docs: [] }
  const officeById = new Map(offices.docs.map(office => [String(office.id), office]))
  return owned
    .filter(({ doc }) => doc.status !== 'retired')
    .map(item => {
      const office = officeById.get(relationId(item.doc.office))
      return {
        id: String(item.doc.id),
        collection: item.collection,
        name:
          item.collection === 'assets'
            ? item.doc.alias || item.doc.hostname || item.doc.ip || 'Activo de red'
            : item.doc.alias,
        office_id: relationId(item.doc.office),
        office_name: office?.name ?? '',
        office_active: office?.is_active !== false,
      }
    })
}
