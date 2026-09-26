import type { Payload, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'

export type SnapshotTrigger =
  | { type: 'manual'; userId: string }
  | { type: 'scheduled' }
  | { type: 'pre_audit' }

async function allDocs(payload: Payload, collection: 'assets' | 'non-network-assets', where: Where) {
  const docs: unknown[] = []
  let page = 1
  while (true) {
    const result = await payload.find({ collection, where, overrideAccess: true, depth: 0, limit: 100, page })
    docs.push(...result.docs)
    if (!result.hasNextPage) return docs
    page += 1
  }
}

export async function createInventorySnapshot(
  payload: Payload,
  officeId: string,
  triggeredBy: SnapshotTrigger
) {
  const office = await payload.findByID({ collection: 'offices', id: officeId, overrideAccess: true, depth: 0 })
  const organizationId = relationId(office.organization)
  const [network, nonNetwork, latest] = await Promise.all([
    allDocs(payload, 'assets', { office: { equals: officeId } }),
    allDocs(payload, 'non-network-assets', { office: { equals: officeId } }),
    payload.find({
      collection: 'risk-evaluations', overrideAccess: true, depth: 0, limit: 1,
      sort: '-evaluated_at',
      where: { and: [{ organization: { equals: organizationId } }, { office: { equals: officeId } }] },
    }),
  ])
  // A snapshot always references a concrete result; if none exists yet, calculate before writing.
  const riskEvaluation = latest.docs[0] ?? await recalculateRisk(payload, { organizationId, officeId })
  // AUDIT: immutable inventory snapshot references the exact immutable risk evaluation shown with it.
  return payload.create({
    collection: 'inventory-snapshots', overrideAccess: true,
    data: {
      organization: organizationId,
      office: officeId,
      taken_at: new Date().toISOString(),
      generated_by: triggeredBy.type,
      triggered_by_user: triggeredBy.type === 'manual' ? triggeredBy.userId : null,
      risk_score: riskEvaluation.id,
      assessment_results_snapshot: {
        evaluation_id: riskEvaluation.id,
        score: riskEvaluation.score,
        coverage: riskEvaluation.coverage,
        unknown_percentage: riskEvaluation.unknown_percentage,
        evaluated_at: riskEvaluation.evaluated_at,
      },
      assets_dump: { network: structuredClone(network), non_network: structuredClone(nonNetwork) },
    },
  })
}
