import type { StatusTone } from '@/components/ui/StatusBadge'
import type { RiskContributionDTO } from './service'

// Shared by the Risk Score page and the Security Review summary so both read the same way.

export const RISK_BAND_TONE: Record<string, StatusTone> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

export const RISK_BAND_COLOR: Record<string, string> = {
  low: 'green',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
}

export const RISK_SCORE_MEANING = 'del riesgo evaluado sigue sin tratar'
export const RISK_SCORE_SCALE = '0 % = todo controlado · 100 % = ningún control funciona'

// Plain-language reason for each engine reason_code, so a user knows why a check has this state
// and what to do next. Unknown codes fall back to the status label.
const REASONS: Record<string, string | Partial<Record<RiskContributionDTO['status'], string>>> = {
  asset_unconfirmed: 'Equipo sin identificar: confirmalo en el inventario',
  answer_missing: 'Falta responder la revisión o la respuesta venció',
  evaluable: 'Según la revisión respondida',
  not_evaluable: 'La revisión tiene respuestas "No lo sé"',
  not_applicable: 'Marcado como "No aplica"',
  inventory_completeness: {
    compliant: 'Identificado, con responsable y autorizado',
    not_evaluable: 'Falta asignar un responsable o confirmar la autorización',
  },
  criticality_assignment: {
    compliant: 'Tiene la importancia para el negocio asignada',
    not_evaluable: 'Falta indicar qué tan importante es para el negocio',
  },
  authorization_status: {
    compliant: 'Equipo autorizado',
    non_compliant: 'Equipo marcado como no autorizado',
    not_evaluable: 'Falta confirmar si el equipo está autorizado',
  },
  scan_missing_or_incomplete: 'El último escaneo no fue completo',
  network_prohibited: 'Tiene un servicio de red no permitido',
  network_review_required: 'Un servicio de red necesita revisión',
  network_expected: 'Sólo tiene servicios de red esperados',
  agent_missing: 'La oficina no tiene un agente de escaneo',
  agent_reporting: 'El agente de la oficina está reportando',
  agent_not_reporting: 'El agente de la oficina dejó de reportar',
}

export function riskReasonLabel(
  row: Pick<RiskContributionDTO, 'reason_code' | 'status'> & { excluded?: boolean }
) {
  if (row.excluded) return 'Excluido temporalmente de las revisiones'
  const reason = REASONS[row.reason_code]
  return typeof reason === 'string' ? reason : (reason?.[row.status] ?? null)
}
