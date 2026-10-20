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

// Qué significa cada resultado para el usuario (ver domain/inventories/processScanReport.ts:
// un escaneo `failed` no se aplica al inventario; `completed` y `partial` sí).
export const SCAN_EXECUTION_DESCRIPTION: Record<string, string> = {
  completed: 'El escaneo terminó sin problemas y actualizó el inventario.',
  partial:
    'El escaneo actualizó el inventario con lo que pudo leer, pero tuvo limitaciones o algunos equipos fueron rechazados.',
  failed: 'El escaneo no pudo completarse y no modificó el inventario.',
}

export const SCAN_DISCOVERY_DESCRIPTION: Record<string, string> = {
  complete: 'Se buscaron equipos con todos los métodos previstos.',
  partial: 'Algunos métodos de búsqueda fallaron: puede haber equipos que no aparezcan.',
  failed: 'La búsqueda de equipos falló.',
  not_attempted: 'No se buscaron equipos en este escaneo.',
  unknown: 'El agente no informó cómo resultó la búsqueda de equipos.',
}
