import type { CollectionAfterChangeHook } from 'payload'
import type { Asset } from '@/app/types/payload-types'
import { reconcileAssetAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'
import { relationId } from '@/lib/relationId'

const relationChanged = (current: unknown, previous: unknown) =>
  (current ? relationId(current) : null) !== (previous ? relationId(previous) : null)

export function assetAssessmentApplicabilityChanged(
  doc: Asset,
  previousDoc: Asset | undefined,
  operation: 'create' | 'update'
): boolean {
  if (operation === 'create' || !previousDoc) return true
  return (
    doc.status !== previousDoc.status ||
    doc.identified !== previousDoc.identified ||
    doc.identification_status !== previousDoc.identification_status ||
    doc.confirmed_type !== previousDoc.confirmed_type ||
    relationChanged(doc.office, previousDoc.office) ||
    relationChanged(doc.organization, previousDoc.organization)
  )
}

// Punto único para identificación, cambio de tipo, retiro e ingesta. La aplicabilidad mira
// exclusivamente confirmed_type; inferred_type y los servicios técnicos nunca crean preguntas.
export const reconcileAssessmentApplicability: CollectionAfterChangeHook<Asset> = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (!assetAssessmentApplicabilityChanged(doc, previousDoc, operation)) return doc
  await reconcileAssetAssessmentInstance(req.payload, doc, 'asset_identified', req)
  return doc
}
