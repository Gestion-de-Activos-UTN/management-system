import type { Payload } from 'payload'
import { relationId } from '@/lib/relationId'
import { getRiskSummary } from '@/domain/assessments/getRiskSummary'
import { POLICY_CATALOG } from '@/domain/assessments/catalog'

export type SnapshotTrigger =
  { type: 'manual'; userId: string } | { type: 'scheduled' } | { type: 'pre_audit' }

export async function createInventorySnapshot(
  payload: Payload,
  officeId: string,
  triggeredBy: SnapshotTrigger
) {
  const office = await payload.findByID({
    collection: 'offices',
    id: officeId,
    overrideAccess: true,
    depth: 0,
  })
  const organizationId = relationId(office.organization)

  const settingsResult = await payload.find({
    collection: 'organization-settings',
    where: { organization: { equals: organizationId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const settings = settingsResult.docs[0]
  const policy = settings
    ? {
        key: settings.assessment_policy_key,
        version: settings.assessment_policy_version,
        selected_at: settings.assessment_policy_selected_at,
        risk_weights: POLICY_CATALOG.find(
          candidate =>
            candidate.key === settings.assessment_policy_key &&
            candidate.version === settings.assessment_policy_version
        )?.risk_weights,
      }
    : null

  // depth:0 a propósito: nunca poblar relaciones anidadas en el dump (ver nota en
  // collections/InventorySnapshots/index.ts) — assets_dump guarda IDs planos, no sub-documentos
  // vivos de agent/office/organization/owner.
  const [liveAssetsResult, liveNonNetworkAssetsResult] = await Promise.all([
    payload.find({
      collection: 'assets',
      where: { office: { equals: officeId } },
      overrideAccess: true,
      depth: 0,
      limit: 5000,
    }),
    // El inventario "en vivo" que ve el usuario en Other Assets es tan parte del inventario
    // como Network — un snapshot que solo copiara Assets estaría documentando la mitad de lo
    // que la UI ya muestra bajo el mismo nombre "Inventory".
    payload.find({
      collection: 'non-network-assets',
      where: { office: { equals: officeId } },
      overrideAccess: true,
      depth: 0,
      limit: 5000,
    }),
  ])

  // Copia desconectada antes de persistir — payload.find no garantiza plain objects de por vida
  // (getters/prototipos internos según hooks/versión). Sin este clone, `assets_dump` podría
  // terminar arrastrando una referencia en vez de un valor congelado en `taken_at`.
  const networkAssetsDump = structuredClone(liveAssetsResult.docs)
  const nonNetworkAssetsDump = structuredClone(liveNonNetworkAssetsResult.docs)

  // Risk y cobertura se calculan desde ComplianceResults vigentes; el dump de inventario se
  // conserva por separado y nunca se usa como sustituto de evidencia de cumplimiento.
  const risk = await getRiskSummary(payload, { organizationId, officeId })

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, organization, office, taken_at}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
  const snapshot = await payload.create({
    collection: 'inventory-snapshots',
    overrideAccess: true,
    data: {
      organization: organizationId,
      office: officeId,
      taken_at: new Date().toISOString(),
      generated_by: triggeredBy.type,
      triggered_by_user: triggeredBy.type === 'manual' ? triggeredBy.userId : null,
      risk_score: {
        global: risk.summary.risk_score,
        evaluated_percentage: risk.summary.evaluated_percentage,
        requires_attention: risk.summary.requires_attention,
        not_evaluable: risk.summary.not_evaluable,
        policy_snapshot: policy,
      },
      assessment_results_snapshot: {
        summary: risk.summary,
        evidence: risk.evidence,
      },
      assets_dump: { network: networkAssetsDump, non_network: nonNetworkAssetsDump },
    },
  })

  return snapshot
}
