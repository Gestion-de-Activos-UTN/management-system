import { RISK_CONTROLS_V2, RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import type { IndexBand } from '@/domain/risk/deficiency-index'
import type { Priority, Reason } from '@/domain/risk/priority'
import { networkExplanation } from '@/domain/assessments/network-explanations'
import { portalHref } from '@/lib/portal-href'
import { formatDate } from '@/lib/format-date'
import { riskAssetPath } from '@/modules/assets/asset-path'
import type { DeficiencyItemDTO, PendingItemDTO, ReasonDTO } from './service'

// Shared by the Risk Score page and the Security Review summary so both read the same way.

// Typed by IndexBand: a missing or legacy band key fails the type-check instead of rendering raw.
export const RISK_BAND_COLOR: Record<IndexBand, string> = {
  low: 'green',
  moderate: 'yellow',
  high: 'orange',
  very_high: 'red',
}

export const RISK_SCORE_MEANING =
  'Índice de deficiencias: cuánto de lo evaluado no cumple, ponderado por importancia.'
export const RISK_SCORE_SCALE = '0 = sin deficiencias · 100 = ningún control cumple'

const CONTROL_TITLE = new Map<string, string>(
  RISK_CONTROLS_V2.map(control => [control.key, control.title])
)
export const controlTitle = (key: string) => CONTROL_TITLE.get(key) ?? key

// Typed by Priority: a missing level fails the type-check.
export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
}
export const PRIORITY_COLOR: Record<Priority, string> = {
  low: 'gray',
  medium: 'yellow',
  high: 'orange',
  critical: 'red',
}

// Propuesta §3: «verificación» never claims a proven vulnerability.
export const REASON_CLASS_LABEL: Record<Reason['class'], string> = {
  deficiency: 'Deficiencia',
  improvement: 'Mejora',
  verification: 'Verificación pendiente: no es una vulnerabilidad comprobada',
  missing_information: 'Falta información',
  review_pending: 'Revisión pendiente',
}

// Adjustments applied by priority.ts::answerReasons.
export const ADJUSTMENT_LABEL: Record<string, string> = {
  type_override: 'Prioridad según el tipo de equipo',
  criticality_elevation: 'Prioridad elevada por ser un equipo de criticidad alta',
  critical_combination: 'Prioridad crítica: problema directo en un equipo crítico',
}

// Plain-language text of every reason_code a reason can carry (priority.ts::pairReasons,
// network-evidence.ts, risk-lists.ts). Network services with a rule read networkExplanation instead.
const REASONS: Record<string, string> = {
  asset_unconfirmed: 'Equipo sin identificar: confírmalo en el inventario',
  answer_missing: 'Falta responder la revisión o la respuesta venció',
  answer_unknown: 'Se respondió "No lo sé"',
  not_evaluable: 'La revisión tiene respuestas "No lo sé"',
  inventory_completeness: 'Falta asignar un responsable o confirmar la autorización',
  criticality_assignment: 'Falta indicar qué tan importante es para el negocio',
  authorization_status: 'Falta confirmar si el equipo está autorizado',
  asset_unauthorized: 'Equipo marcado como no autorizado',
  scan_missing_or_incomplete: 'El equipo está fuera de línea: no hay un escaneo vigente',
  technical_coverage_insufficient: 'El último escaneo no fue completo',
  network_prohibited: 'Servicio de red no permitido por la línea base',
  network_review: 'Un servicio de red necesita revisión',
  service_state_unconfirmed: 'No se pudo confirmar el estado del servicio',
  service_unclassified: 'Servicio de red sin regla en la línea base',
  service_confidence_insufficient: 'No se identificó el servicio con suficiente certeza',
  agent_missing: 'La oficina no tiene un agente de escaneo: revisa su instalación',
  agent_not_reporting:
    'El agente de la oficina dejó de reportar: revisa que esté encendido y conectado',
}

/** 'tcp:23' → 'TCP 23'. */
export const formatService = (serviceKey: string) => serviceKey.replace(':', ' ').toUpperCase()

const QUESTIONS = new Map(RISK_QUESTIONS_V2.map(question => [question.key, question]))

export const questionPrompt = (questionKey: string) =>
  QUESTIONS.get(questionKey)?.prompt ?? questionKey

/** Question of a reason key `<subject>|<control>|<question>:<option>` (subordinate_to). */
export const questionOfReasonKey = (reasonKey: string) => reasonKey.split('|').pop()!.split(':')[0]

/** Plain-language text of one reason: a short title and, when there is one, the context. */
export function reasonLabel(reason: ReasonDTO): { title: string; detail?: string } {
  if (reason.question_key) {
    const option = QUESTIONS.get(reason.question_key)?.options.find(
      item => item.key === reason.option_key
    )
    return {
      title: `Respuesta: ${option?.label ?? reason.option_key}`,
      detail: questionPrompt(reason.question_key),
    }
  }
  const previous = reason.previous
    ? `En la ${reason.previous.date_kind === 'observation' ? 'observación' : 'evaluación'} del ${formatDate(reason.previous.date)} estaba clasificado como no permitido.`
    : undefined
  if (reason.service_key) {
    const explanation =
      networkExplanation({ check_key: reason.check_key ?? '', reason_code: reason.reason_code }) ??
      REASONS[reason.reason_code]
    return {
      title: formatService(reason.service_key),
      detail: [explanation, previous].filter(Boolean).join(' ') || undefined,
    }
  }
  return { title: REASONS[reason.reason_code] ?? reason.reason_code, detail: previous }
}

const ANSWER_CODES = new Set(['answer_missing', 'answer_unknown', 'not_evaluable'])
const INVENTORY_CODES = new Set([
  'asset_unconfirmed',
  'inventory_completeness',
  'criticality_assignment',
  'authorization_status',
  'asset_unauthorized',
])

/** Where an item is fixed, from routes that already exist; null when the portal has no page for it. */
export function itemAction(
  item: DeficiencyItemDTO | PendingItemDTO,
  asOrganization?: string | null
): { label: string; href: string } | null {
  const answer = item.reasons.some(
    reason => reason.question_key || ANSWER_CODES.has(reason.reason_code)
  )
  if (answer)
    return { label: 'Ir a revisiones', href: portalHref('/portal/security-review', asOrganization) }
  const inventory = item.reasons.some(
    reason =>
      reason.service_key || INVENTORY_CODES.has(reason.reason_code) || item.control_key === 'A.8.21'
  )
  if (!inventory) return null
  const { subject } = item
  const path =
    subject.kind === 'asset'
      ? riskAssetPath(subject.asset_key)
      : subject.kind === 'office'
        ? `/portal/inventory?officeId=${encodeURIComponent(subject.id)}`
        : '/portal/inventory'
  return path ? { label: 'Abrir en el inventario', href: portalHref(path, asOrganization) } : null
}
