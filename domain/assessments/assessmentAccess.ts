import type { AssessmentInstance, Asset, NonNetworkAsset } from '@/app/types/payload-types'
import type { TenantContext } from '@/access/tenant/resolveTenantContext'
import { relationId } from '@/lib/relationId'

export function canReadAssessment(ctx: TenantContext, assessment: AssessmentInstance): boolean {
  if (ctx.isPlatformAdmin)
    return !ctx.organizationId || relationId(assessment.organization) === ctx.organizationId
  if (!ctx.organizationId || relationId(assessment.organization) !== ctx.organizationId)
    return false
  if (assessment.scope === 'organization') return true
  return Boolean(assessment.office && ctx.officeIds.includes(relationId(assessment.office)))
}

export function canAnswerAssessment(
  ctx: TenantContext,
  assessment: AssessmentInstance,
  asset?: Asset | NonNetworkAsset | null
): boolean {
  if (
    ctx.isPlatformAdmin ||
    !ctx.organizationId ||
    relationId(assessment.organization) !== ctx.organizationId
  )
    return false
  if (ctx.role === 'org_admin') return true
  if (assessment.scope === 'organization') return false
  const officeAllowed = Boolean(
    assessment.office && ctx.officeIds.includes(relationId(assessment.office))
  )
  if (ctx.role === 'office_manager') return officeAllowed
  return assessment.scope === 'asset' && asset?.owner
    ? relationId(asset.owner) === ctx.userId
    : false
}
