import type { Payload } from 'payload'
import { relationId } from '@/lib/relationId'
import { computeRiskScore } from './computeRiskScore'

export type SnapshotTrigger =
  | { type: 'manual'; userId: string }
  | { type: 'scheduled' }
  | { type: 'pre_audit' }

export async function createInventorySnapshot(payload: Payload, officeId: string, triggeredBy: SnapshotTrigger) {
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
  const policy = settingsResult.docs[0]?.risk_score_policy ?? null

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

  // computeRiskScore sigue viendo SOLO Network a propósito: la heurística actual puntúa riesgo
  // como "% de superficie offline", y un NonNetworkAsset nunca puede estar 'offline' (solo
  // 'active'/'retired') — sumarlo ahí diluiría el score (más denominador, casi nunca más
  // numerador) sin ningún fundamento real, no es "menos riesgo" solo por cargar más licencias a
  // mano. Corresponde resolverlo cuando exista el algoritmo real (RF-30, fuera de alcance hoy),
  // no forzarlo acá con la heurística placeholder.
  // TODO(risk-engine): cuando el risk score real (RF-30) tenga granularidad por-asset, excluir
  // de networkAssetsDump/el cálculo los assets con identified === false — un activo detectado
  // pero no confirmado por un humano no debería pesar en el score todavía.
  const riskScoreGlobal = computeRiskScore(networkAssetsDump)

  const snapshot = await payload.create({
    collection: 'inventory-snapshots',
    overrideAccess: true,
    data: {
      organization: organizationId,
      office: officeId,
      taken_at: new Date().toISOString(),
      generated_by: triggeredBy.type,
      triggered_by_user: triggeredBy.type === 'manual' ? triggeredBy.userId : null,
      risk_score: { global: riskScoreGlobal, policy_snapshot: policy },
      assets_dump: { network: networkAssetsDump, non_network: nonNetworkAssetsDump },
    },
  })

  // AUDIT: this action must emit an AuditLogs entry (chain_hash over {id, organization, office, taken_at}, previous hash for this organization_id)
  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists

  return snapshot
}
