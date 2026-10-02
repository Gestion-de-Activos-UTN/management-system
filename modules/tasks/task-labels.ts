import type { StatusTone } from '@/components/ui/StatusBadge'

export const TASK_STATUS_LABELS: Record<string, string> = {
  planned: 'Planificada',
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}

export const TASK_STATUS_TONES: Record<string, StatusTone> = {
  planned: 'info',
  pending: 'neutral',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
}

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

export const TASK_REFERENCE_LABELS: Record<string, string> = {
  offices: 'Inventario de oficina',
  assets: 'Activo de red',
  'non-network-assets': 'Otro activo',
  'assessment-instances': 'Revisión de seguridad',
  'compliance-results': 'Resultado de cumplimiento',
  'inventory-snapshots': 'Instantánea de inventario',
  'scan-reports': 'Reporte de escaneo',
  'risk-evaluations': 'Evaluación de riesgo',
  agents: 'Agente de escaneo',
}
