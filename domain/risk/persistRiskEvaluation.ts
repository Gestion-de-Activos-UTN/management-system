import type { Payload, PayloadRequest } from 'payload'
import type { RiskPolicyKey } from './catalog-v2'
import type { RiskEvaluationResult } from './engine'

/**
 * Writes one evaluation and all its contributions in a single transaction, so a partial failure
 * never publishes an incomplete evaluation as the latest one.
 */
export async function persistRiskEvaluation(
  payload: Payload,
  input: {
    organizationId: string
    officeId?: string
    policy: RiskPolicyKey
    result: RiskEvaluationResult
    undeterminedExposure: ReadonlyArray<{ asset_id: string; cidr: string }>
    // When the evidence was read, not when it was saved: a slow run over older evidence must not
    // become the latest evaluation.
    evaluatedAt: Date
  },
  externalReq?: PayloadRequest
) {
  const ownsTransaction = !externalReq?.transactionID
  const transactionID = externalReq?.transactionID ?? (await payload.db.beginTransaction())
  const req = externalReq
    ? Object.assign(externalReq, { transactionID })
    : ({ transactionID } as PayloadRequest)
  const { result } = input

  try {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {risk evaluation: organization, office, score, coverage, engine_version}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const evaluation = await payload.create({
      collection: 'risk-evaluations',
      overrideAccess: true,
      req,
      data: {
        organization: input.organizationId,
        office: input.officeId ?? null,
        catalog_version: 2,
        engine_version: 2,
        policy_key: input.policy,
        evaluated_at: input.evaluatedAt.toISOString(),
        rro_raw: result.rro_raw,
        rro_adjusted: result.rro_adjusted,
        riem: result.riem,
        score: result.score,
        base_band: result.base_band,
        final_band: result.final_band,
        coverage: result.coverage,
        unknown_percentage: result.unknown_percentage,
        confidence: result.confidence,
        effective_confidence: result.effective_confidence,
        counts: result.counts,
        alerts: {
          critical_assets: result.critical_asset_alerts,
          systemic_failures: result.controls
            .filter(item => item.systemic_failure)
            .map(item => item.control_key),
          severe_concentration: result.severe_concentration,
          severe_concentration_percentage: result.severe_concentration_percentage,
          undetermined_exposure: input.undeterminedExposure,
        },
        control_summary: result.controls,
        asset_summary: result.assets,
      },
    })
    // ponytail: one insert per contribution; switch to a bulk insert if large fleets make this slow.
    for (const row of result.contributions) {
      await payload.create({
        collection: 'risk-contributions',
        overrideAccess: true,
        req,
        data: {
          organization: input.organizationId,
          office: input.officeId ?? null,
          evaluation: evaluation.id,
          asset_key: row.asset_id,
          asset: row.asset_id.startsWith('asset:') ? row.asset_id.slice('asset:'.length) : null,
          manual_asset: row.asset_id.startsWith('manual:')
            ? row.asset_id.slice('manual:'.length)
            : null,
          control_key: row.control_key,
          criticality: row.criticality,
          scope_multiplier: row.scope_multiplier,
          severity: row.severity,
          exposure: row.exposure,
          exposure_source: row.exposure_source ?? null,
          efficacy: row.efficacy,
          effect_snapshot: {
            reason_code: row.reason_code,
            unit_kind: row.unit_kind,
            unit_id: row.unit_id,
          },
          status: row.status,
          inherent_risk: row.inherent_risk,
          residual_risk: row.residual_risk,
          coverage_weight: row.coverage_weight,
          excluded: Boolean(row.excluded),
          reason_code: row.reason_code,
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
  }
}
