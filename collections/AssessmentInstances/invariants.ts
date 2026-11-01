import { APIError } from 'payload'
import type { AssessmentScope } from '@/domain/assessments/catalog'

export const CLOSED_ASSESSMENT_STATUSES = ['completed', 'expired', 'superseded'] as const
export type AssessmentStatus =
  'pending' | 'in_progress' | (typeof CLOSED_ASSESSMENT_STATUSES)[number]

export function assertAssessmentTarget(
  scope: AssessmentScope,
  officeId: string | null,
  assetId: string | null,
  manualAssetId: string | null = null
): void {
  const scopeLabel =
    scope === 'organization' ? 'organización' : scope === 'office' ? 'oficina' : 'activo'
  const valid =
    (scope === 'organization' && !officeId && !assetId && !manualAssetId) ||
    (scope === 'office' && Boolean(officeId) && !assetId && !manualAssetId) ||
    (scope === 'asset' && Boolean(officeId) && Boolean(assetId) !== Boolean(manualAssetId))

  if (!valid) {
    throw new APIError(
      `El alcance de la revisión no es compatible con el destino «${scopeLabel}».`,
      400,
      undefined,
      true
    )
  }
}

export function assertAssessmentMutable(status: AssessmentStatus): void {
  if (CLOSED_ASSESSMENT_STATUSES.includes(status as never)) {
    const statusLabel =
      status === 'completed' ? 'completada' : status === 'expired' ? 'vencida' : 'reemplazada'
    throw new APIError(`La revisión ${statusLabel} no se puede modificar.`, 409, undefined, true)
  }
}

export function assessmentTargetKey(
  scope: AssessmentScope,
  officeId: string | null,
  assetId: string | null,
  manualAssetId: string | null = null
): string {
  if (scope === 'organization') return 'organization'
  if (scope === 'office') return `office:${officeId}`
  return manualAssetId ? `manual_asset:${manualAssetId}` : `asset:${assetId}`
}
