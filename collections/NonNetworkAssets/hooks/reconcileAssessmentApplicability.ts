import type { CollectionAfterChangeHook } from 'payload'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import {
  reconcileManualAssetAssessmentInstance,
  syncManualAssetAssessmentAssignee,
} from '@/domain/assessments/reconcileAssessmentInstance'
import { enqueueRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'
import { relationId } from '@/lib/relationId'

const relationChanged = (current: unknown, previous: unknown) =>
  (current ? relationId(current) : null) !== (previous ? relationId(previous) : null)

export function manualAssessmentApplicabilityChanged(
  doc: NonNetworkAsset,
  previousDoc: NonNetworkAsset | undefined,
  operation: 'create' | 'update'
): boolean {
  if (operation === 'create' || !previousDoc) {
    return doc.asset_category === 'computer' && doc.status !== 'retired'
  }
  // Moving offices re-homes the open cycle: its assignees and office managers belong to the
  // office. Completed answers stay valid because they describe the device, not the office.
  return (
    relationChanged(doc.office, previousDoc.office) ||
    doc.asset_category !== previousDoc.asset_category ||
    (doc.status === 'retired') !== (previousDoc.status === 'retired') ||
    doc.assessment_scope !== previousDoc.assessment_scope ||
    doc.assessment_excluded_until !== previousDoc.assessment_excluded_until
  )
}

export const reconcileAssessmentApplicability: CollectionAfterChangeHook<NonNetworkAsset> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (manualAssessmentApplicabilityChanged(doc, previousDoc, operation)) {
    const reason =
      operation === 'update' &&
      previousDoc &&
      (doc.assessment_scope !== previousDoc.assessment_scope ||
        doc.assessment_excluded_until !== previousDoc.assessment_excluded_until)
        ? 'assessment_scope_changed'
        : operation === 'update' && previousDoc && relationChanged(doc.office, previousDoc.office)
          ? 'office_changed'
          : 'asset_identified'
    await reconcileManualAssetAssessmentInstance(req.payload, doc, reason, req)
  }
  if (operation === 'update' && previousDoc && relationChanged(doc.owner, previousDoc.owner)) {
    await syncManualAssetAssessmentAssignee(req.payload, doc, req)
  }
  // The previous office loses this asset, so its evaluation must be refreshed too.
  await enqueueRiskRecalculation(req.payload, relationId(doc.organization), [
    relationId(doc.office),
    previousDoc?.office ? relationId(previousDoc.office) : null,
  ])
  return doc
}
