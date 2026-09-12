import type { CollectionAfterChangeHook } from 'payload'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import {
  reconcileManualAssetAssessmentInstance,
  syncManualAssetAssessmentAssignee,
} from '@/domain/assessments/reconcileAssessmentInstance'
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
  return (
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
        : 'asset_identified'
    await reconcileManualAssetAssessmentInstance(req.payload, doc, reason, req)
  }
  if (operation === 'update' && previousDoc && relationChanged(doc.owner, previousDoc.owner)) {
    await syncManualAssetAssessmentAssignee(req.payload, doc, req)
  }
  return doc
}
