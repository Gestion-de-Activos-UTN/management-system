import type { StatusTone } from '@/components/ui/StatusBadge'

export const SCAN_REPORT_STATUS_LABEL: Record<string, string> = {
  received: 'Recibido',
  processed: 'Procesado',
  failed: 'Con error',
}

export const SCAN_REPORT_STATUS_TONE: Record<string, StatusTone> = {
  received: 'neutral',
  processed: 'success',
  failed: 'danger',
}

// Resultado de la ejecución del agente y de cada fase de cobertura (contracts/scan-report.schema.ts).
export const SCAN_RUN_LABEL: Record<string, string> = {
  completed: 'completa',
  complete: 'completa',
  partial: 'parcial',
  failed: 'fallida',
  not_attempted: 'no intentada',
  unknown: 'desconocida',
}
