import type { Payload } from 'payload'
import type { AssessmentInstance } from '@/app/types/payload-types'
import { relationId } from '@/lib/relationId'
import {
  reconcileAssessmentInstance,
  reconcileAssetAssessmentInstance,
  reconcileManualAssetAssessmentInstance,
} from './reconcileAssessmentInstance'

export type ExpiredAssessmentReconciliationSummary = {
  expired_cycles_examined: number
  cycles_created: number
  cycles_preserved: number
  cycles_skipped: number
}

async function reconcileExpiredAssessment(payload: Payload, assessment: AssessmentInstance) {
  if (assessment.scope === 'asset' && assessment.manual_asset) {
    const asset = await payload
      .findByID({
        collection: 'non-network-assets',
        id: relationId(assessment.manual_asset),
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => null)
    return asset
      ? reconcileManualAssetAssessmentInstance(payload, asset, 'answer_expired')
      : { action: 'none' as const }
  }

  if (assessment.scope === 'asset' && assessment.asset) {
    const asset = await payload
      .findByID({
        collection: 'assets',
        id: relationId(assessment.asset),
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => null)
    return asset
      ? reconcileAssetAssessmentInstance(payload, asset, 'answer_expired')
      : { action: 'none' as const }
  }

  const organizationId = relationId(assessment.organization)
  if (assessment.scope === 'organization') {
    const organization = await payload
      .findByID({
        collection: 'organizations',
        id: organizationId,
        overrideAccess: true,
        depth: 0,
      })
      .catch(() => null)
    return organization
      ? reconcileAssessmentInstance(
          payload,
          {
            scope: 'organization',
            id: String(organization.id),
            organizationId,
            is_active: organization.is_active ?? true,
          },
          'answer_expired'
        )
      : { action: 'none' as const }
  }

  const office = await payload
    .findByID({
      collection: 'offices',
      id: relationId(assessment.office),
      overrideAccess: true,
      depth: 0,
    })
    .catch(() => null)
  return office
    ? reconcileAssessmentInstance(
        payload,
        {
          scope: 'office',
          id: String(office.id),
          organizationId,
          is_active: office.is_active ?? true,
        },
        'answer_expired'
      )
    : { action: 'none' as const }
}

export async function reconcileExpiredAssessments(
  payload: Payload,
  now = new Date()
): Promise<ExpiredAssessmentReconciliationSummary> {
  const summary: ExpiredAssessmentReconciliationSummary = {
    expired_cycles_examined: 0,
    cycles_created: 0,
    cycles_preserved: 0,
    cycles_skipped: 0,
  }
  let page = 1
  let totalPages = 1

  do {
    const expired = await payload.find({
      collection: 'assessment-instances',
      where: {
        and: [
          { status: { equals: 'completed' } },
          { due_at: { less_than_equal: now.toISOString() } },
        ],
      },
      overrideAccess: true,
      depth: 0,
      limit: 200,
      page,
      sort: 'due_at',
    })
    totalPages = expired.totalPages
    for (const assessment of expired.docs) {
      summary.expired_cycles_examined += 1
      const result = await reconcileExpiredAssessment(payload, assessment)
      if (result.action === 'created') summary.cycles_created += 1
      else if (result.action === 'preserved') summary.cycles_preserved += 1
      else summary.cycles_skipped += 1
    }
    page += 1
  } while (page <= totalPages)

  return summary
}
