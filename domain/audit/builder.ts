import { randomUUID } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import { AuditCanonicalError, auditCanonicalJson } from './canonical'
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORY_SECTION,
  type AuditActionCode,
  type AuditActionSpec,
  type AuditEntityType,
  type AuditOutcomeCode,
} from './catalog'
import { AuditEnvelopeError, parseAuditEnvelope, type AuditEnvelopeV1 } from './envelope'
import {
  AuditNetworkContextError,
  parseNetworkContext,
  type NetworkContextV1,
} from './network-context'

// Builder de eventos del AuditLog (documentation/planes/audit-log/02-modelo-y-captura.md §2 y §4,
// 03 §4). `addAuditEvent` arma el evento, lo valida y lo acumula en el buffer de la transacción en
// curso; no escribe nada. Lo escribe el dueño de la transacción al cerrar
// (commitTransactionWithAudit, F1b paso 4b), que completa lo que depende de la cadena y de las
// claves: sequence, created_at, previous_hash, hmac_key_id, network_digest y network_expires_at.
//
// Estricto con los eventos nuevos (el sobre es permisivo para poder leer los viejos):
// - la acción existe y no está retirada; categoría y sección salen del catálogo, no del llamador;
// - entity_type es el de la acción, o 'operation' para la raíz de una operación agrupada, cuyo
//   entity_id es el operation_id;
// - outcome: solo `success`, salvo que la acción habilite otros (catalog.ts, `outcomes`);
// - autor según el origen: interactive → persona o PlatformAdmin; agent → agente; job, demo y
//   migration → sistema (los jobs reciben un actor de sistema explícito, 02 §1; la demo nunca se
//   atribuye a una persona, G13). El iniciador solo existe si ejecuta el sistema (02 §2);
// - visit_id solo para un PlatformAdmin dentro de una organización;
// - contexto de red de la solicitud: obligatorio con origen interactive o agent (aunque la IP sea
//   `unknown`, 02 §6); con job, demo o migration no hay solicitud: ausente o fuente `none`;
// - un hijo apunta a un evento ya acumulado en la misma transacción, misma cadena y misma operación
//   (padre/hijo no cruza tenants, 02 §2);
// - payload JSON estricto y de hasta AUDIT_PAYLOAD_MAX_BYTES (02 §3: superar el límite aborta con
//   error claro, nunca se trunca).
// El payload se copia y se congela al acumularlo: lo que se firma es lo que había en ese momento.
//
// Buffer (03 §4): uno por intento de transacción, indexado por su id (UUID de Payload). Los comandos
// anidados que heredan la transacción solo acumulan; el dueño lo toma al confirmar o lo descarta al
// revertir, así un reintento empieza vacío. Mapa del módulo y no un campo del `req`: si otro `req`
// usara la misma transacción, sus eventos irían al mismo buffer en vez de perderse.

export const AUDIT_PAYLOAD_MAX_BYTES = 256 * 1024

export type AuditOrigin = AuditEnvelopeV1['origin']

export type AuditActor =
  | { type: 'user'; id: string; role: string }
  | { type: 'platform_admin'; id: string; role: string }
  | { type: 'agent'; id: string; role?: string | null }
  | { type: 'system' }

export type AuditScope =
  | { kind: 'organization'; organizationId: string; officeIds?: readonly string[] }
  | { kind: 'platform' }

export interface AuditEventInput {
  action: AuditActionCode
  scope: AuditScope
  entity: { type: AuditEntityType; id: string }
  actor: AuditActor
  origin: AuditOrigin
  payload: Record<string, unknown>
  /** Por defecto `success`. */
  outcome?: AuditOutcomeCode
  /** Por defecto, uno nuevo; un hijo hereda el de su padre. */
  operationId?: string
  parentEventId?: string
  initiatedBy?: { type: 'user' | 'platform_admin' | 'agent'; id: string }
  visitId?: string
  /** Fecha de observación, si es distinta del registro (ISO en UTC con milisegundos). */
  occurredAt?: string
  /** Contexto de red de la solicitud, en claro (requestNetwork, F1b paso 5). */
  network?: NetworkContextV1
}

/** Campos que completa el cierre transaccional (dependen de la cadena y de las claves). */
type ChainFields =
  | 'sequence'
  | 'created_at'
  | 'previous_hash'
  | 'hmac_key_id'
  | 'network_digest'
  | 'network_expires_at'

export type AuditEventDraft = Readonly<Omit<AuditEnvelopeV1, ChainFields>>

export interface PendingAuditEvent {
  readonly draft: AuditEventDraft
  readonly network: Readonly<NetworkContextV1> | null
}

export class AuditBuilderError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Evento de AuditLog rechazado:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
    this.name = 'AuditBuilderError'
  }
}

type ActionIndex = ReadonlyMap<string, AuditActionSpec>

const DEFAULT_ACTIONS: ActionIndex = new Map(AUDIT_ACTIONS.map(spec => [spec.code, spec]))

const ACTOR_BY_ORIGIN: Record<AuditOrigin, readonly AuditActor['type'][]> = {
  interactive: ['user', 'platform_admin'],
  agent: ['agent'],
  job: ['system'],
  demo: ['system'],
  migration: ['system'],
}
const ACTOR_COLLECTION = {
  user: 'users',
  platform_admin: 'admins',
  agent: 'agents',
  system: null,
} as const
const REQUEST_ORIGINS = new Set<AuditOrigin>(['interactive', 'agent'])

type TransactionId = string | number
const buffers = new Map<TransactionId, PendingAuditEvent[]>()

/**
 * Valida el evento y lo acumula en el buffer de la transacción de `req`. Devuelve su id (para
 * usarlo como parent_event_id de los hijos). Lanza AuditBuilderError si no cumple; sin
 * transacción activa no hay dónde acumular, así que también lanza.
 */
export async function addAuditEvent(req: PayloadRequest, input: AuditEventInput): Promise<string> {
  const transactionId = await activeTransactionId(req)
  const buffer = buffers.get(transactionId) ?? []
  const event = buildPendingAuditEvent(input, buffer)
  buffer.push(event)
  buffers.set(transactionId, buffer)
  return event.draft.id
}

/** Para el dueño de la transacción al confirmar: entrega los eventos en orden y vacía el buffer. */
export function takeAuditEvents(transactionId: TransactionId): readonly PendingAuditEvent[] {
  const events = buffers.get(transactionId) ?? []
  buffers.delete(transactionId)
  return events
}

/** Para el dueño de la transacción al revertir: los eventos se descartan con el resto. */
export function discardAuditEvents(transactionId: TransactionId): void {
  buffers.delete(transactionId)
}

/** Solo para tests: transacciones con eventos sin tomar ni descartar. */
export function pendingAuditTransactionCount(): number {
  return buffers.size
}

/**
 * Arma y valida un evento sin acumularlo. `buffered` son los eventos ya acumulados en la misma
 * transacción (para validar el padre). `actions` permite probar con un catálogo de prueba.
 */
export function buildPendingAuditEvent(
  input: AuditEventInput,
  buffered: readonly PendingAuditEvent[] = [],
  actions: ActionIndex = DEFAULT_ACTIONS
): PendingAuditEvent {
  const issues: string[] = []
  const issue = (message: string) => issues.push(message)

  const spec = actions.get(input.action)
  if (!spec) throw new AuditBuilderError(['action: acción desconocida.'])
  if (spec.retired) issue('action: acción retirada; solo se conserva para leer eventos viejos.')

  // Entidad: la de la acción, o la raíz de una operación (entity_id = operation_id).
  const parent = input.parentEventId
    ? buffered.find(event => event.draft.id === input.parentEventId)
    : undefined
  const operationId = input.operationId ?? parent?.draft.operation_id ?? randomUUID()
  if (input.entity.type === 'operation') {
    if (input.operationId === undefined)
      issue('operationId: la raíz de una operación necesita su operation_id explícito.')
    else if (input.entity.id !== input.operationId)
      issue('entity.id: en la raíz de una operación es el operation_id.')
  } else if (input.entity.type !== spec.entity) {
    issue('entity.type: no es el tipo de entidad de la acción.')
  }

  const outcome = input.outcome ?? 'success'
  if (!(spec.outcomes ?? ['success']).includes(outcome))
    issue('outcome: la acción no admite ese resultado.')

  // Autor, iniciador y visita según el origen.
  const { actor } = input
  if (!ACTOR_BY_ORIGIN[input.origin]?.includes(actor.type))
    issue('actor.type: no corresponde al origen.')
  if (input.initiatedBy && actor.type !== 'system')
    issue('initiatedBy: solo existe cuando ejecuta el sistema.')
  if (input.visitId && (actor.type !== 'platform_admin' || input.scope.kind !== 'organization'))
    issue('visitId: solo para un PlatformAdmin dentro de una organización.')

  // Contexto de red de la solicitud.
  let network: NetworkContextV1 | null = null
  if (input.network !== undefined) {
    try {
      network = parseNetworkContext(input.network)
    } catch (error) {
      if (!(error instanceof AuditNetworkContextError)) throw error
      error.issues.forEach(detail => issue(`network.${detail}`))
    }
  }
  if (REQUEST_ORIGINS.has(input.origin)) {
    if (input.network === undefined) issue('network: falta el contexto de red de la solicitud.')
    else if (network?.source === 'none') issue('network: una solicitud no tiene fuente "none".')
  } else if (network && network.source !== 'none') {
    issue('network: sin solicitud (job, demo, migration) la fuente es "none" o no hay contexto.')
  }

  // Payload: JSON estricto, copiado y con tope de tamaño.
  let payload: Record<string, unknown> = {}
  try {
    const canonical = auditCanonicalJson(input.payload)
    if (Buffer.byteLength(canonical, 'utf8') > AUDIT_PAYLOAD_MAX_BYTES)
      issue(
        `payload: supera ${AUDIT_PAYLOAD_MAX_BYTES} bytes (se divide en hijos, nunca se trunca).`
      )
    payload = JSON.parse(canonical) as Record<string, unknown>
  } catch (error) {
    if (!(error instanceof AuditCanonicalError)) throw error
    issue(`payload: ${error.reason} (en ${error.path.replace(/^\$/, 'payload')})`)
  }

  const scope = input.scope
  const chainId = scope.kind === 'platform' ? 'platform' : `org:${scope.organizationId}`
  const draft: Omit<AuditEnvelopeV1, ChainFields> = {
    schema_version: 1,
    id: randomUUID(),
    scope_kind: scope.kind,
    chain_id: chainId,
    organization_id: scope.kind === 'platform' ? null : scope.organizationId,
    office_ids: scope.kind === 'platform' ? [] : [...new Set(scope.officeIds ?? [])].sort(),
    occurred_at: input.occurredAt ?? null,
    category_code: spec.category,
    action_code: spec.code,
    section_code: AUDIT_CATEGORY_SECTION[spec.category],
    entity_type: input.entity.type,
    entity_id: input.entity.id,
    actor_type: actor.type,
    actor_id: actor.type === 'system' ? null : actor.id,
    actor_collection: ACTOR_COLLECTION[actor.type],
    actor_role: actor.type === 'system' ? null : (actor.role ?? null),
    initiated_by_type: input.initiatedBy?.type ?? null,
    initiated_by_id: input.initiatedBy?.id ?? null,
    operation_id: operationId,
    parent_event_id: input.parentEventId ?? null,
    visit_id: input.visitId ?? null,
    origin: input.origin,
    outcome,
    payload,
  }

  // Padre: ya acumulado en esta transacción, en la misma cadena y la misma operación.
  if (input.parentEventId !== undefined) {
    if (!parent) issue('parentEventId: no es un evento de esta transacción.')
    else {
      if (parent.draft.chain_id !== chainId) issue('parentEventId: el padre es de otra cadena.')
      if (parent.draft.operation_id !== operationId)
        issue('parentEventId: el padre es de otra operación.')
    }
  }

  // El resto (formatos, alcance, autor) lo valida el sobre, con valores provisorios en los campos
  // que completa el cierre. Los mensajes del sobre nombran el campo, nunca el valor.
  try {
    parseAuditEnvelope({
      ...draft,
      sequence: 1,
      created_at: new Date().toISOString(),
      previous_hash: null,
      hmac_key_id: 'pending-validation',
      network_digest: network ? '0'.repeat(64) : null,
      network_expires_at: network ? new Date().toISOString() : null,
    })
  } catch (error) {
    if (!(error instanceof AuditEnvelopeError)) throw error
    // El payload ya se revisó arriba con un mensaje propio.
    error.issues.filter(detail => !detail.startsWith('payload:')).forEach(issue)
  }

  if (issues.length > 0) throw new AuditBuilderError(issues)
  return { draft: deepFreeze(draft), network: network ? Object.freeze({ ...network }) : null }
}

async function activeTransactionId(req: PayloadRequest): Promise<TransactionId> {
  const id = await req.transactionID
  if (id === undefined || id === null || id === '' || !req.payload?.db?.sessions?.[id])
    throw new AuditBuilderError([
      'transacción: addAuditEvent corre dentro de una transacción activa (withTransaction).',
    ])
  return id
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
