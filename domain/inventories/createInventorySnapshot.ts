import { actorRelation } from '@/lib/actor-relation'
import type { Payload, PayloadRequest, Where } from 'payload'
import { withTransaction } from '@/domain/with-transaction'
import { relationId } from '@/lib/relationId'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import { scoreVisible } from '@/domain/risk/constants'

export type SnapshotTrigger =
  { type: 'manual'; userId: string } | { type: 'scheduled' } | { type: 'pre_audit' }

async function allDocs(
  payload: Payload,
  collection: 'assets' | 'non-network-assets',
  where: Where,
  req: PayloadRequest
) {
  const docs: unknown[] = []
  let page = 1
  while (true) {
    const result = await payload.find({
      collection,
      req,
      where: { and: [where, { deleted_at: { exists: false } }] },
      overrideAccess: true,
      depth: 0,
      limit: 100,
      page,
    })
    docs.push(...result.docs)
    if (!result.hasNextPage) return docs
    page += 1
  }
}

export async function createInventorySnapshot(
  payload: Payload,
  officeId: string,
  triggeredBy: SnapshotTrigger,
  request?: PayloadRequest
) {
  return withTransaction(payload, request, async req => {
  const office = await payload.findByID({
    collection: 'offices',
    req,
    id: officeId,
    overrideAccess: true,
    depth: 0,
  })
  const organizationId = relationId(office.organization)
  const [network, nonNetwork] = await Promise.all([
    allDocs(payload, 'assets', { office: { equals: officeId } }, req),
    allDocs(payload, 'non-network-assets', { office: { equals: officeId } }, req),
  ])
  // Always calculated now, never the latest stored result: a queued recalculation may still be
  // pending, and the snapshot must pair the asset dump with the risk of that same moment.
  const riskEvaluation = await recalculateRisk(payload, { organizationId, officeId }, req)
  // AUDIT: immutable inventory snapshot references the exact immutable risk evaluation shown with it.
  return payload.create({
    collection: 'inventory-snapshots',
    req,
    overrideAccess: true,
    data: {
      organization: organizationId,
      office: officeId,
      taken_at: new Date().toISOString(),
      generated_by: triggeredBy.type,
      triggered_by_user: triggeredBy.type === 'manual' ? actorRelation(req, triggeredBy.userId) : null,
      risk_score: riskEvaluation.id,
      assessment_results_snapshot: {
        evaluation_id: riskEvaluation.id,
        // Same visibility rule as the risk endpoint; the raw value stays behind evaluation_id.
        score: scoreVisible(riskEvaluation.confidence) ? riskEvaluation.score : null,
        coverage: riskEvaluation.coverage,
        unknown_percentage: riskEvaluation.unknown_percentage,
        evaluated_at: riskEvaluation.evaluated_at,
      },
      assets_dump: { network: structuredClone(network), non_network: structuredClone(nonNetwork) },
    },
  })
  }, { isolationLevel: 'repeatable read' })
}
