import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import {
  AUDIT_PAYLOAD_MAX_BYTES,
  AuditBuilderError,
  addAuditEvent,
  buildPendingAuditEvent,
  discardAuditEvents,
  bufferedAuditEvents,
  openAuditTransaction,
  openAuditTransactionCount,
  takeAuditEvents,
  type AuditEventInput,
  type PendingAuditEvent,
} from './builder'
import { AUDIT_ACTIONS, AUDIT_CATEGORY_SECTION, type AuditActionSpec } from './catalog'

const ORG = '0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e'
const ORG2 = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const OFFICE_A = '1a2b3c4d-0000-4000-8000-000000000001'
const OFFICE_B = '1a2b3c4d-0000-4000-8000-000000000002'
const USER = '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170'
const NETWORK = {
  source: 'unknown',
  ip: null,
  family: null,
  captured_at: '2026-11-23T12:00:00.000Z',
} as const

function input(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    action: 'scan.rename',
    scope: { kind: 'organization', organizationId: ORG, officeIds: [OFFICE_B, OFFICE_A, OFFICE_B] },
    entity: { type: 'scan_report', id: 'report-2026-11-23-001' },
    actor: { type: 'user', id: USER, role: 'org_admin' },
    origin: 'interactive',
    payload: { changes: [{ field: 'display_name', before: 'Escaneo 1', after: 'Oficina Ñandú' }] },
    network: NETWORK,
    ...overrides,
  }
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof AuditBuilderError, `se esperaba AuditBuilderError: ${error}`)
    return [...error.issues]
  }
  assert.fail('se esperaba que el evento fuera rechazado')
}

const rejects = (
  patch: Partial<AuditEventInput>,
  field: string,
  buffered: PendingAuditEvent[] = []
) => {
  const issues = issuesOf(() => buildPendingAuditEvent(input(patch), buffered))
  assert.ok(
    issues.some(issue => issue.startsWith(`${field}`)),
    `se esperaba un error en ${field}, hubo ${JSON.stringify(issues)}`
  )
}

/** Catálogo de prueba: el real, más los casos que hoy no tiene. */
function catalogWith(...extra: AuditActionSpec[]) {
  const index = new Map<string, AuditActionSpec>(AUDIT_ACTIONS.map(spec => [spec.code, spec]))
  for (const spec of extra) index.set(spec.code, spec)
  return index
}

/** req falso con una transacción "activa" (la sesión existe en payload.db.sessions). */
function fakeReq(transactionId: string = randomUUID()) {
  return {
    transactionID: transactionId,
    payload: { db: { sessions: { [transactionId]: {} } } },
  } as unknown as PayloadRequest
}

test('arma el evento: categoría y sección del catálogo, oficinas como conjunto, success por defecto', () => {
  const { draft, network } = buildPendingAuditEvent(input())
  assert.equal(draft.schema_version, 1)
  assert.match(draft.id, /^[0-9a-f-]{36}$/)
  assert.match(draft.operation_id, /^[0-9a-f-]{36}$/)
  assert.notEqual(draft.id, draft.operation_id)
  assert.equal(draft.chain_id, `org:${ORG}`)
  assert.equal(draft.category_code, 'inventory_evidence')
  assert.equal(draft.section_code, 'inventory')
  assert.deepEqual(draft.office_ids, [OFFICE_A, OFFICE_B])
  assert.equal(draft.outcome, 'success')
  assert.equal(draft.actor_collection, 'users')
  assert.equal(draft.parent_event_id, null)
  assert.deepEqual(network, NETWORK)
  // Lo que completa el cierre transaccional no está en el borrador.
  for (const field of ['sequence', 'created_at', 'previous_hash', 'hmac_key_id', 'network_digest'])
    assert.ok(!(field in draft), `${field} no lo pone el builder`)
})

test('la sección sale del catálogo: el llamador no la elige', () => {
  const forced = { ...input(), section_code: 'tasks' } as unknown as AuditEventInput
  assert.equal(buildPendingAuditEvent(forced).draft.section_code, 'inventory')
  const task = buildPendingAuditEvent(
    input({ action: 'task.create', entity: { type: 'task', id: randomUUID() } })
  ).draft
  assert.equal(task.section_code, AUDIT_CATEGORY_SECTION.task_creation)
  const message = buildPendingAuditEvent(
    input({
      action: 'portal_message.create',
      scope: { kind: 'platform' },
      entity: { type: 'portal_message', id: randomUUID() },
      actor: { type: 'platform_admin', id: USER, role: 'platform_admin' },
    })
  ).draft
  assert.deepEqual(
    [message.chain_id, message.section_code, message.office_ids],
    ['platform', 'platform', []]
  )
})

test('copia y congela el payload: cambiarlo después no cambia lo que se firma', () => {
  const source = input()
  const { draft } = buildPendingAuditEvent(source)
  ;(source.payload.changes as Array<{ after: string }>)[0]!.after = 'otro valor'
  assert.equal((draft.payload.changes as Array<{ after: string }>)[0]!.after, 'Oficina Ñandú')
  assert.ok(Object.isFrozen(draft) && Object.isFrozen(draft.payload))
  assert.throws(() => {
    ;(draft.payload as Record<string, unknown>).extra = 1
  }, TypeError)
})

test('rechaza una acción retirada y una desconocida', () => {
  const retired: AuditActionSpec = {
    code: 'scan.old_rename',
    category: 'inventory_evidence',
    label: 'Acción vieja',
    entity: 'scan_report',
    retired: true,
  }
  const issues = issuesOf(() =>
    buildPendingAuditEvent(
      input({ action: 'scan.old_rename' as AuditEventInput['action'] }),
      [],
      catalogWith(retired)
    )
  )
  assert.ok(
    issues.some(issue => /acción retirada/.test(issue)),
    JSON.stringify(issues)
  )
  const unknown = issuesOf(() =>
    buildPendingAuditEvent(input({ action: 'scan.delete_everything' as AuditEventInput['action'] }))
  )
  assert.deepEqual(unknown, ['action: acción desconocida.'])
})

test('entity_type: el de la acción, u operation con entity_id = operation_id', () => {
  rejects({ entity: { type: 'task', id: randomUUID() } }, 'entity.type')
  const operation = randomUUID()
  // Raíz de una operación agrupada (task.create_multiple tiene entidad 'operation').
  const root = buildPendingAuditEvent(
    input({
      action: 'task.create_multiple',
      entity: { type: 'operation', id: operation },
      operationId: operation,
    })
  ).draft
  assert.deepEqual(
    [root.entity_type, root.entity_id, root.operation_id],
    ['operation', operation, operation]
  )
  // Cualquier acción puede ser la raíz de su operación.
  assert.doesNotThrow(() =>
    buildPendingAuditEvent(
      input({ entity: { type: 'operation', id: operation }, operationId: operation })
    )
  )
  rejects({ entity: { type: 'operation', id: randomUUID() }, operationId: operation }, 'entity.id')
  rejects({ entity: { type: 'operation', id: operation } }, 'operationId')
})

test('outcome: solo success, salvo que la acción habilite otro', () => {
  rejects({ outcome: 'failed' }, 'outcome')
  rejects({ outcome: 'rolled_back' as AuditEventInput['outcome'] }, 'outcome')
  const enabled = AUDIT_ACTIONS.find(spec => spec.code === 'scan.rename')!
  const catalog = catalogWith({ ...enabled, outcomes: ['success', 'failed'] })
  assert.equal(
    buildPendingAuditEvent(input({ outcome: 'failed' }), [], catalog).draft.outcome,
    'failed'
  )
  // Habilitar `failed` no habilita `denied`.
  const denied = issuesOf(() => buildPendingAuditEvent(input({ outcome: 'denied' }), [], catalog))
  assert.deepEqual(denied, ['outcome: la acción no admite ese resultado.'])
})

test('el autor corresponde al origen; la demo y los jobs nunca se atribuyen a una persona', () => {
  const agent = { type: 'agent', id: 'agent-001' } as const
  const system = { type: 'system' } as const
  rejects({ actor: agent }, 'actor.type') // interactive con agente
  rejects({ origin: 'agent' }, 'actor.type') // agente con persona
  for (const origin of ['job', 'demo', 'migration'] as const)
    rejects({ origin, network: undefined }, 'actor.type')
  // Combinaciones válidas.
  const job = buildPendingAuditEvent(
    input({ origin: 'job', actor: system, network: undefined })
  ).draft
  assert.deepEqual(
    [job.actor_type, job.actor_id, job.actor_collection, job.actor_role],
    ['system', null, null, null]
  )
  const scan = buildPendingAuditEvent(input({ origin: 'agent', actor: agent })).draft
  assert.deepEqual([scan.actor_collection, scan.actor_role], ['agents', null])
})

test('iniciador solo si ejecuta el sistema; visita solo de un PlatformAdmin en una organización', () => {
  const initiatedBy = { type: 'user', id: USER } as const
  rejects({ initiatedBy }, 'initiatedBy')
  const job = buildPendingAuditEvent(
    input({ origin: 'job', actor: { type: 'system' }, network: undefined, initiatedBy })
  ).draft
  assert.deepEqual([job.initiated_by_type, job.initiated_by_id], ['user', USER])

  const visitId = randomUUID()
  rejects({ visitId }, 'visitId')
  const admin = { type: 'platform_admin', id: USER, role: 'platform_admin' } as const
  assert.equal(buildPendingAuditEvent(input({ actor: admin, visitId })).draft.visit_id, visitId)
  rejects({ actor: admin, visitId, scope: { kind: 'platform' } }, 'visitId')
})

test('contexto de red: obligatorio en solicitudes; sin solicitud, ausente o fuente none', () => {
  rejects({ network: undefined }, 'network')
  rejects({ network: { ...NETWORK, source: 'none' } }, 'network')
  const system = { type: 'system' } as const
  rejects({ origin: 'job', actor: system }, 'network') // job con fuente unknown
  const none = buildPendingAuditEvent(
    input({ origin: 'job', actor: system, network: { ...NETWORK, source: 'none' } })
  )
  assert.equal(none.network?.source, 'none')
  assert.equal(
    buildPendingAuditEvent(input({ origin: 'job', actor: system, network: undefined })).network,
    null
  )
  // IP inválida: el error nombra el campo, nunca la IP.
  const issues = issuesOf(() =>
    buildPendingAuditEvent(
      input({
        network: {
          source: 'trusted_proxy',
          ip: '203.0.113.7:8080',
          family: 'ipv4',
          captured_at: NETWORK.captured_at,
        },
      })
    )
  )
  assert.ok(
    issues.some(issue => issue.startsWith('network.ip')),
    JSON.stringify(issues)
  )
  assert.ok(!issues.join('\n').includes('203.0.113.7'))
})

test('hijo: el padre está en la misma transacción, cadena y operación', () => {
  const root = buildPendingAuditEvent(input())
  const child = buildPendingAuditEvent(input({ parentEventId: root.draft.id }), [root]).draft
  assert.equal(child.parent_event_id, root.draft.id)
  assert.equal(child.operation_id, root.draft.operation_id, 'el hijo hereda la operación')
  rejects({ parentEventId: randomUUID() }, 'parentEventId', [root])
  rejects({ parentEventId: root.draft.id, operationId: randomUUID() }, 'parentEventId', [root])
  rejects(
    { parentEventId: root.draft.id, scope: { kind: 'organization', organizationId: ORG2 } },
    'parentEventId',
    [root]
  )
})

test('payload: JSON estricto y con tope de tamaño; los errores no muestran valores', () => {
  const nan = issuesOf(() =>
    buildPendingAuditEvent(input({ payload: { reason: 'motivo-privado', score: NaN } }))
  )
  assert.deepEqual(nan, ['payload: número no finito (NaN o Infinity) (en payload.score)'])
  const big = 'x'.repeat(AUDIT_PAYLOAD_MAX_BYTES)
  rejects({ payload: { note: big } }, 'payload')
  assert.doesNotThrow(() =>
    buildPendingAuditEvent(input({ payload: { note: 'x'.repeat(AUDIT_PAYLOAD_MAX_BYTES - 20) } }))
  )
  // Ids mal formados: el sobre nombra el campo, nunca el valor.
  const issues = issuesOf(() =>
    buildPendingAuditEvent(input({ actor: { type: 'user', id: 'Usuario-Secreto', role: '' } }))
  )
  assert.ok(issues.length > 0)
  assert.ok(!issues.join('\n').includes('Usuario-Secreto'))
})

test('addAuditEvent: sin transacción activa, o no abierta por withTransaction, no acumula', async () => {
  const noTransaction = { payload: { db: { sessions: {} } } } as unknown as PayloadRequest
  await assert.rejects(addAuditEvent(noTransaction, input()), AuditBuilderError)
  const closed = {
    transactionID: 'tx-cerrada',
    payload: { db: { sessions: {} } },
  } as unknown as PayloadRequest
  await assert.rejects(addAuditEvent(closed, input()), AuditBuilderError)
  // Sesión activa pero abierta por Payload (sin buffer): nadie escribiría el evento.
  const payloadOwned = fakeReq()
  await assert.rejects(addAuditEvent(payloadOwned, input()), (error: unknown) => {
    assert.ok(error instanceof AuditBuilderError)
    assert.match(error.issues[0]!, /no la abrió withTransaction/)
    return true
  })
})

test('buffer: acumula en orden por transacción; tomar o descartar borra la entrada', async () => {
  const baseline = openAuditTransactionCount()
  const txA = randomUUID()
  openAuditTransaction(txA)
  const req = fakeReq(txA)
  // Un comando anidado con otro objeto req pero la misma transacción va al mismo buffer.
  const nested = fakeReq(txA)
  const rootId = await addAuditEvent(req, input())
  const childId = await addAuditEvent(nested, input({ parentEventId: rootId }))
  const txB = randomUUID()
  openAuditTransaction(txB)
  await addAuditEvent(fakeReq(txB), input())
  assert.equal(openAuditTransactionCount(), baseline + 2)

  const events = takeAuditEvents(txA)
  assert.deepEqual(
    events.map(event => event.draft.id),
    [rootId, childId]
  )
  assert.deepEqual(takeAuditEvents(txA), [], 'tomar borra la entrada')
  await assert.rejects(addAuditEvent(req, input()), AuditBuilderError, 'cerrada, ya no acumula')
  discardAuditEvents(txB)
  assert.deepEqual(bufferedAuditEvents(txB), [])
  assert.equal(openAuditTransactionCount(), baseline)

  // Un evento rechazado no queda a medias en el buffer.
  const txC = randomUUID()
  openAuditTransaction(txC)
  await assert.rejects(addAuditEvent(fakeReq(txC), input({ outcome: 'failed' })), AuditBuilderError)
  assert.deepEqual(bufferedAuditEvents(txC), [])
  discardAuditEvents(txC)
  assert.equal(openAuditTransactionCount(), baseline)
})

test('un id de transacción ya abierto no se reabre: nunca hereda eventos', async () => {
  const tx = randomUUID()
  openAuditTransaction(tx)
  await addAuditEvent(fakeReq(tx), input())
  assert.throws(() => openAuditTransaction(tx), AuditBuilderError)
  assert.equal(bufferedAuditEvents(tx).length, 1, 'el buffer existente no se pisa')
  discardAuditEvents(tx)
  // Una vez cerrado, el mismo id empieza vacío.
  openAuditTransaction(tx)
  assert.deepEqual(bufferedAuditEvents(tx), [])
  discardAuditEvents(tx)
})

test('todas las copias del módulo comparten el mismo buffer (globalThis + Symbol.for)', async () => {
  // Una segunda instancia del módulo, como la que puede cargar Next en otro bundle.
  const copy = (await import(`./builder.ts?copia=${randomUUID()}`)) as typeof import('./builder')
  assert.notEqual(copy.addAuditEvent, addAuditEvent, 'tiene que ser otra instancia del módulo')
  const tx = randomUUID()
  copy.openAuditTransaction(tx) // abre en una copia (como withTransaction)
  const id = await addAuditEvent(fakeReq(tx), input()) // acumula en otra (como un hook)
  assert.deepEqual(
    copy.takeAuditEvents(tx).map(event => event.draft.id),
    [id],
    'el cierre lee lo que acumuló la otra copia'
  )
  assert.equal(openAuditTransactionCount(), copy.openAuditTransactionCount())
})
