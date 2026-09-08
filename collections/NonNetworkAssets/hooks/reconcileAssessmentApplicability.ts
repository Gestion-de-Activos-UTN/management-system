import type { CollectionAfterChangeHook } from 'payload'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { reconcileManualAssetAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import { relationId } from '@/lib/relationId'

const relationChanged = (current: unknown, previous: unknown) =>
  (current ? relationId(current) : null) !== (previous ? relationId(previous) : null)

export function manualAssessmentApplicabilityChanged(
  doc: NonNetworkAsset,
  previousDoc: NonNetworkAsset | undefined,
  operation: 'create' | 'update'
): boolean {
  if (operation === 'create' || !previousDoc) return true
  return (
    doc.asset_category !== previousDoc.asset_category ||
    doc.status !== previousDoc.status ||
    relationChanged(doc.office, previousDoc.office) ||
    relationChanged(doc.organization, previousDoc.organization)
  )
}

export const reconcileAssessmentApplicability: CollectionAfterChangeHook<NonNetworkAsset> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (!manualAssessmentApplicabilityChanged(doc, previousDoc, operation)) return doc
  await reconcileManualAssetAssessmentInstance(req.payload, doc, 'asset_identified', req)
  return doc
}
