import type { Payload, PayloadRequest } from 'payload'
import type { RiskEvaluation } from '@/app/types/payload-types'
import { CRITICALITY_WEIGHTS } from './constants'
import type { DeficiencyPair } from './deficiency-pairs'
import type { EvaluationData } from './evaluation-from-pairs'

/** One stored contribution per pair; the live consolidation maps its pairs with this same function. */
export function contributionFromPair(pair: DeficiencyPair) {
  return {
    asset_key: pair.asset_key,
    asset: pair.asset_key.startsWith('asset:') ? pair.asset_key.slice('asset:'.length) : null,
    manual_asset: pair.asset_key.startsWith('manual:') ? pair.asset_key.slice('manual:'.length) : null,
    asset_office: pair.asset_office_id,
    asset_type: pair.asset_type,
    control_key: pair.control_key,
    criticality: pair.criticality,
    criticality_weight: CRITICALITY_WEIGHTS[pair.criticality],
    applicability: pair.applicability,
    compliance: pair.compliance,
    status: pair.status,
    reason_code: pair.reason_code,
    priority: pair.priority,
    evidence: pair.evidence as unknown as Record<string, unknown>,
    reasons: pair.reasons as unknown as Record<string, unknown>[],
  }
}

/**
 * Writes one evaluation and all its contributions in a single transaction, so a partial failure
 * never publishes an incomplete evaluation as the latest one.
 */
export async function persistRiskEvaluation(
  payload: Payload,
  input: {
    organizationId: string
    officeId?: string
    evaluation: EvaluationData
    pairs: readonly DeficiencyPair[]
    // When the evidence was read, not when it was saved: a slow run over older evidence must not
    // become the latest evaluation.
    evaluatedAt: Date
  },
  externalReq?: PayloadRequest
) {
  const previousTransaction = externalReq?.transactionID
  const ownsTransaction = !externalReq?.transactionID
  const transactionID = externalReq?.transactionID ?? (await payload.db.beginTransaction())
  const req = externalReq
    ? Object.assign(externalReq, { transactionID })
    : ({ transactionID } as PayloadRequest)

  try {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {risk evaluation: organization, office, index, coverage, visibility, engine_version}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const evaluation = await payload.create({
      collection: 'risk-evaluations',
      overrideAccess: true,
      req,
      data: {
        organization: input.organizationId,
        office: input.officeId ?? null,
        // JSON columns are typed loosely by Payload; the shape is EvaluationData (contracts §5).
        ...(input.evaluation as unknown as Pick<
          RiskEvaluation,
          | 'catalog_version'
          | 'engine_version'
          | 'policy_key'
          | 'index'
          | 'band'
          | 'coverage'
          | 'visibility'
          | 'control_summary'
          | 'warnings'
          | 'asset_summary'
          | 'counts'
          | 'context'
        >),
        evaluated_at: input.evaluatedAt.toISOString(),
      },
    })
    // ponytail: one insert per contribution; switch to a bulk insert if large fleets make this slow.
    for (const pair of input.pairs) {
      await payload.create({
        collection: 'risk-contributions',
        overrideAccess: true,
        req,
        data: {
          organization: input.organizationId,
          office: input.officeId ?? null,
          evaluation: evaluation.id,
          ...contributionFromPair(pair),
        },
      })
    }
    if (ownsTransaction && transactionID) await payload.db.commitTransaction(transactionID)
    // NOTIFY: this event should trigger a Notification Bell entry for {organization security readers, new risk evaluation}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    return evaluation
  } catch (error) {
    if (ownsTransaction && transactionID) await payload.db.rollbackTransaction(transactionID)
    throw error
  } finally {
    if (ownsTransaction && externalReq) externalReq.transactionID = previousTransaction
  }
}
