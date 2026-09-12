import type { CollectionAfterChangeHook } from 'payload'
import type { Asset } from '@/app/types/payload-types'
import {
  reconcileAssetAssessmentInstance,
  syncAssetAssessmentAssignee,
} from '@/domain/assessments/reconcileAssessmentInstance'
import { relationId } from '@/lib/relationId'

const relationChanged = (current: unknown, previous: unknown) =>
  (current ? relationId(current) : null) !== (previous ? relationId(previous) : null)

export function assetAssessmentApplicabilityChanged(
  doc: Asset,
  previousDoc: Asset | undefined,
  operation: 'create' | 'update'
): boolean {
  if (operation === 'create' || !previousDoc) {
    return doc.confirmed_type === 'workstation' && doc.status !== 'retired'
  }
  return (
    doc.confirmed_type !== previousDoc.confirmed_type ||
    (doc.status === 'retired') !== (previousDoc.status === 'retired') ||
    doc.assessment_scope !== previousDoc.assessment_scope ||
    doc.assessment_excluded_until !== previousDoc.assessment_excluded_until
  )
}

// Solo la categoría confirmada y la entrada/salida de retiro cambian la aplicabilidad. Un cambio
// active↔offline o un `needs_review` inferido por el scanner conserva el assessment: una nueva
// versión queda bajo control explícito del usuario.
export const reconcileAssessmentApplicability: CollectionAfterChangeHook<Asset> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (assetAssessmentApplicabilityChanged(doc, previousDoc, operation)) {
    const reason =
      operation === 'update' &&
      previousDoc &&
      (doc.assessment_scope !== previousDoc.assessment_scope ||
        doc.assessment_excluded_until !== previousDoc.assessment_excluded_until)
        ? 'assessment_scope_changed'
        : 'asset_identified'
    await reconcileAssetAssessmentInstance(req.payload, doc, reason, req)
  }
  if (operation === 'update' && previousDoc && relationChanged(doc.owner, previousDoc.owner)) {
    await syncAssetAssessmentAssignee(req.payload, doc, req)
  }
  return doc
}
