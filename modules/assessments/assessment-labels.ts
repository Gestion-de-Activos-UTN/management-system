import type { StatusTone } from '@/components/ui/StatusBadge'

type AssessmentStatus = 'pending' | 'in_progress' | 'completed' | 'expired' | 'superseded'

export const ASSESSMENT_STATUS_LABEL: Record<AssessmentStatus, string> = {
  pending: 'Sin iniciar',
  in_progress: 'En curso',
  completed: 'Completada',
  expired: 'Revisión vencida',
  superseded: 'Reemplazada',
}

export const ASSESSMENT_STATUS_TONE: Record<AssessmentStatus, StatusTone> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
  expired: 'warning',
  superseded: 'neutral',
}

// Quién puede usar "Responder varias" (botón en la lista y la ruta /security-review/bulk).
export const canUseBulkAssessments = (
  tenant: { isPlatformAdmin: boolean; role?: string | null } | undefined
) =>
  Boolean(
    tenant &&
    !tenant.isPlatformAdmin &&
    ['org_admin', 'office_manager', 'org_viewer'].includes(tenant.role ?? '')
  )
