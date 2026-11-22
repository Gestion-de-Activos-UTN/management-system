import { z } from 'zod'
import { AuditCanonicalError, auditCanonicalJson } from './canonical'
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_ENTITY_TYPES } from './catalog'
import { AUDIT_KEY_ID_PATTERN } from './config'

// Sobre v1 de un evento de AuditLog: todo lo que cubre el HMAC de la cadena, es decir, el
// evento persistido completo salvo su propio `chain_hash`
// (documentation/planes/audit-log/02-modelo-y-captura.md §2 y 03 §3). Lo valida el builder
// antes de firmar y el verificador después de leer: un sobre que no cumple no se firma ni se
// da por bueno. Objeto estricto: un campo de más se rechaza, porque se firmaría sin guardarse.
//
// Pendiente para F1b: `section_code` y `outcome` validan solo el formato. Sus listas cerradas
// (una sección por categoría en catalog.ts) se definen como primer paso de F1b; cerrarlas no
// cambia los bytes que se firman. Las acciones retiradas se aceptan: el verificador tiene que
// poder leer eventos viejos (el builder no debe crearlas: F1b).

export const AUDIT_ENVELOPE_VERSION = 1

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const CODE = /^[a-z][a-z0-9_]*$/
/** ISO 8601 en UTC con milisegundos, como lo escribe Date#toISOString. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const uuid = z.string().regex(UUID, 'UUID en minúsculas.')
const hash = z.string().regex(HASH, 'Hash hex de 64 caracteres en minúsculas.')
const code = z.string().regex(CODE, 'Código en minúsculas, dígitos y "_".')
const reference = z.string().min(1).max(256)
// Una sola comprobación: la forma exacta y que la fecha exista (2026-02-30 tiene la forma).
const isInstant = (value: string) =>
  INSTANT.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
const instant = z.string().refine(isInstant, 'Fecha ISO en UTC con milisegundos (y que exista).')

const ACTOR_COLLECTION = {
  user: 'users',
  platform_admin: 'admins',
  agent: 'agents',
  system: null,
} as const

const ACTION_CATEGORY = new Map<string, string>(AUDIT_ACTIONS.map(a => [a.code, a.category]))

export const AuditEnvelopeV1Schema = z
  .strictObject({
    schema_version: z.literal(AUDIT_ENVELOPE_VERSION),
    id: uuid,
    scope_kind: z.enum(['organization', 'platform']),
    chain_id: z.string().min(1),
    organization_id: uuid.nullable(),
    office_ids: z.array(uuid),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    created_at: instant,
    occurred_at: instant.nullable(),
    category_code: z.enum(Object.keys(AUDIT_CATEGORIES) as [string, ...string[]]),
    action_code: z.string().min(1),
    section_code: code,
    entity_type: z.enum(AUDIT_ENTITY_TYPES),
    entity_id: reference,
    actor_type: z.enum(['user', 'platform_admin', 'agent', 'system']),
    actor_id: reference.nullable(),
    actor_collection: z.enum(['users', 'admins', 'agents']).nullable(),
    actor_role: reference.nullable(),
    initiated_by_type: z.enum(['user', 'platform_admin', 'agent']).nullable(),
    initiated_by_id: reference.nullable(),
    operation_id: uuid,
    parent_event_id: uuid.nullable(),
    visit_id: uuid.nullable(),
    origin: z.enum(['interactive', 'agent', 'job', 'demo', 'migration']),
    outcome: code,
    payload: z.record(z.string(), z.unknown()),
    network_digest: hash.nullable(),
    network_expires_at: instant.nullable(),
    hmac_key_id: z.string().regex(AUDIT_KEY_ID_PATTERN, 'Id de clave inválido.'),
    previous_hash: hash.nullable(),
  })
  .superRefine((envelope, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })

    // Alcance: plataforma sin organización ni oficinas; organización con su cadena.
    if (envelope.scope_kind === 'platform') {
      if (envelope.chain_id !== 'platform') issue('chain_id', 'En plataforma debe ser "platform".')
      if (envelope.organization_id !== null)
        issue('organization_id', 'En plataforma debe ser null.')
      if (envelope.office_ids.length > 0) issue('office_ids', 'En plataforma no hay oficinas.')
    } else if (envelope.organization_id === null) {
      issue('organization_id', 'Falta la organización.')
    } else if (envelope.chain_id !== `org:${envelope.organization_id}`) {
      issue('chain_id', 'Debe ser "org:" seguido de organization_id.')
    }

    // office_ids es un conjunto: ordenado y sin repetidos, para que firme siempre igual.
    envelope.office_ids.forEach((id, index) => {
      const previous = envelope.office_ids[index - 1]
      if (previous !== undefined && previous >= id)
        issue('office_ids', 'Deben estar ordenadas y sin repetidos.')
    })

    // Cadena: solo el primer evento no tiene anterior.
    if ((envelope.sequence === 1) !== (envelope.previous_hash === null))
      issue('previous_hash', 'Es null solo en la secuencia 1.')

    // Clasificación: la acción existe y pertenece a la categoría.
    const category = ACTION_CATEGORY.get(envelope.action_code)
    if (category === undefined) issue('action_code', 'Acción desconocida.')
    else if (category !== envelope.category_code)
      issue('action_code', 'La acción no pertenece a esa categoría.')

    // Autor: la colección corresponde al tipo; el sistema no tiene id, colección ni rol.
    if (envelope.actor_collection !== ACTOR_COLLECTION[envelope.actor_type])
      issue('actor_collection', 'No corresponde al tipo de autor.')
    if (envelope.actor_type === 'system') {
      if (envelope.actor_id !== null) issue('actor_id', 'El sistema no tiene id.')
      if (envelope.actor_role !== null) issue('actor_role', 'El sistema no tiene rol.')
    } else {
      if (envelope.actor_id === null) issue('actor_id', 'Falta el id del autor.')
      if (envelope.actor_role === null) issue('actor_role', 'Falta el rol del autor.')
    }

    // Iniciador: los dos campos juntos o ninguno.
    if ((envelope.initiated_by_type === null) !== (envelope.initiated_by_id === null))
      issue('initiated_by_id', 'Tipo e id del iniciador van juntos.')

    // Contexto de red: digest y vencimiento juntos o ninguno.
    if ((envelope.network_digest === null) !== (envelope.network_expires_at === null))
      issue('network_expires_at', 'Digest y vencimiento del contexto de red van juntos.')

    // Payload: JSON estricto (mismas reglas que el resto de lo que se firma).
    try {
      auditCanonicalJson(envelope.payload)
    } catch (error) {
      if (!(error instanceof AuditCanonicalError)) throw error
      issue('payload', `${error.reason} (en ${error.path.replace(/^\$/, 'payload')})`)
    }
  })

export type AuditEnvelopeV1 = z.infer<typeof AuditEnvelopeV1Schema>

export class AuditEnvelopeError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Sobre de AuditLog inválido:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
    this.name = 'AuditEnvelopeError'
  }
}

/**
 * Valida un sobre v1. Los mensajes nombran el campo y la regla, nunca el valor: el sobre
 * lleva datos de negocio y personales.
 */
export function parseAuditEnvelope(value: unknown): AuditEnvelopeV1 {
  const result = AuditEnvelopeV1Schema.safeParse(value)
  if (result.success) return result.data
  throw new AuditEnvelopeError(
    result.error.issues.map(issue => `${issue.path.join('.') || '(sobre)'}: ${issueMessage(issue)}`)
  )
}

// Los mensajes por defecto de Zod pueden incluir el valor recibido (por ejemplo, la clave de
// más en un objeto estricto): se reemplazan por uno genérico según el tipo de falla.
function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'custom' || issue.code === 'invalid_format') return issue.message
  if (issue.code === 'unrecognized_keys')
    return `${issue.keys.length} campo(s) que no son del sobre v1.`
  if (issue.code === 'invalid_type') return `tipo inválido (se esperaba ${issue.expected}).`
  if (issue.code === 'invalid_value') return 'valor fuera de los permitidos.'
  if (issue.code === 'too_small' || issue.code === 'too_big') return 'fuera del rango permitido.'
  return 'valor inválido.'
}
