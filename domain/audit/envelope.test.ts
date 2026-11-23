import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuditEnvelopeError, parseAuditEnvelope, type AuditEnvelopeV1 } from './envelope'
import { FIXTURE_ENVELOPE } from './envelope.fixture'

const with_ = (patch: Record<string, unknown>) => ({ ...FIXTURE_ENVELOPE, ...patch })

function issuesFor(value: unknown): string[] {
  try {
    parseAuditEnvelope(value)
  } catch (error) {
    assert.ok(error instanceof AuditEnvelopeError, `se esperaba AuditEnvelopeError: ${error}`)
    return [...error.issues]
  }
  assert.fail('se esperaba que el sobre fuera rechazado')
}

test('acepta el sobre de ejemplo y lo devuelve igual', () => {
  assert.deepEqual(parseAuditEnvelope(FIXTURE_ENVELOPE), FIXTURE_ENVELOPE)
})

test('acepta un evento de plataforma y uno del sistema', () => {
  const platform: AuditEnvelopeV1 = {
    ...FIXTURE_ENVELOPE,
    scope_kind: 'platform',
    chain_id: 'platform',
    organization_id: null,
    office_ids: [],
  }
  assert.doesNotThrow(() => parseAuditEnvelope(platform))
  const system = with_({
    actor_type: 'system',
    actor_id: null,
    actor_collection: null,
    actor_role: null,
    initiated_by_type: 'user',
    initiated_by_id: '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170',
    origin: 'job',
  })
  assert.doesNotThrow(() => parseAuditEnvelope(system))
  assert.doesNotThrow(() =>
    parseAuditEnvelope(
      with_({ sequence: 1, previous_hash: null, network_digest: null, network_expires_at: null })
    )
  )
})

test('un agente puede no tener rol; una persona o un PlatformAdmin no', () => {
  const agent = { actor_type: 'agent', actor_collection: 'agents', origin: 'agent' }
  assert.doesNotThrow(() => parseAuditEnvelope(with_({ ...agent, actor_role: null })))
  assert.doesNotThrow(() => parseAuditEnvelope(with_({ ...agent, actor_role: 'scanner' })))
  for (const [actor_type, actor_collection] of [
    ['user', 'users'],
    ['platform_admin', 'admins'],
  ]) {
    const issues = issuesFor(with_({ actor_type, actor_collection, actor_role: null }))
    assert.deepEqual(issues, ['actor_role: Falta el rol del autor.'], actor_type)
  }
})

test('rechaza cada regla del sobre indicando el campo', () => {
  const ORG2 = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['otra versión', { schema_version: 2 }, 'schema_version'],
    ['id en mayúsculas', { id: FIXTURE_ENVELOPE.id.toUpperCase() }, 'id'],
    ['id que no es UUID', { id: 'evento-1' }, 'id'],
    [
      'plataforma con cadena de organización',
      { scope_kind: 'platform', organization_id: null, office_ids: [] },
      'chain_id',
    ],
    [
      'plataforma con organización',
      { scope_kind: 'platform', chain_id: 'platform', office_ids: [] },
      'organization_id',
    ],
    [
      'plataforma con oficinas',
      { scope_kind: 'platform', chain_id: 'platform', organization_id: null },
      'office_ids',
    ],
    ['organización sin id', { organization_id: null }, 'organization_id'],
    ['cadena de otra organización', { organization_id: ORG2 }, 'chain_id'],
    [
      'oficinas desordenadas',
      { office_ids: [...FIXTURE_ENVELOPE.office_ids].reverse() },
      'office_ids',
    ],
    [
      'oficina repetida',
      { office_ids: [FIXTURE_ENVELOPE.office_ids[0], FIXTURE_ENVELOPE.office_ids[0]] },
      'office_ids',
    ],
    ['secuencia 0', { sequence: 0 }, 'sequence'],
    ['secuencia con decimales', { sequence: 2.5 }, 'sequence'],
    ['secuencia 1 con anterior', { sequence: 1 }, 'previous_hash'],
    ['secuencia 2 sin anterior', { previous_hash: null }, 'previous_hash'],
    [
      'hash anterior en mayúsculas',
      { previous_hash: FIXTURE_ENVELOPE.previous_hash!.toUpperCase() },
      'previous_hash',
    ],
    ['fecha sin milisegundos', { created_at: '2026-11-22T21:05:39Z' }, 'created_at'],
    ['fecha con zona en vez de Z', { created_at: '2026-11-22T21:05:39.123+00:00' }, 'created_at'],
    ['fecha inexistente', { created_at: '2026-02-30T00:00:00.000Z' }, 'created_at'],
    ['fecha que no es fecha', { occurred_at: 'ayer' }, 'occurred_at'],
    ['categoría desconocida', { category_code: 'otra_categoria' }, 'category_code'],
    ['acción desconocida', { action_code: 'scan.delete_everything' }, 'action_code'],
    ['acción de otra categoría', { action_code: 'task.create' }, 'action_code'],
    ['sección con mayúsculas', { section_code: 'Inventario' }, 'section_code'],
    ['tipo de entidad desconocido', { entity_type: 'banana' }, 'entity_type'],
    ['entidad sin id', { entity_id: '' }, 'entity_id'],
    ['colección que no corresponde al autor', { actor_collection: 'admins' }, 'actor_collection'],
    ['persona sin id', { actor_id: null }, 'actor_id'],
    ['persona sin rol', { actor_role: null }, 'actor_role'],
    [
      'PlatformAdmin sin rol',
      { actor_type: 'platform_admin', actor_collection: 'admins', actor_role: null },
      'actor_role',
    ],
    [
      'sistema con id',
      { actor_type: 'system', actor_collection: null, actor_role: null },
      'actor_id',
    ],
    ['iniciador sin id', { initiated_by_type: 'agent' }, 'initiated_by_id'],
    ['id de iniciador sin tipo', { initiated_by_id: 'x' }, 'initiated_by_id'],
    ['origen desconocido', { origin: 'api' }, 'origin'],
    ['resultado con espacios', { outcome: 'not ok' }, 'outcome'],
    ['payload que es un array', { payload: [] }, 'payload'],
    ['payload con NaN', { payload: { changes: [{ value: NaN }] } }, 'payload'],
    ['digest sin vencimiento', { network_expires_at: null }, 'network_expires_at'],
    ['vencimiento sin digest', { network_digest: null }, 'network_expires_at'],
    ['digest corto', { network_digest: 'abc' }, 'network_digest'],
    ['id de clave inválido', { hmac_key_id: 'Clave_1' }, 'hmac_key_id'],
  ]
  for (const [name, patch, field] of cases) {
    const issues = issuesFor(with_(patch))
    assert.ok(
      issues.some(issue => issue.startsWith(`${field}: `)),
      `${name}: se esperaba un error en ${field}, hubo ${JSON.stringify(issues)}`
    )
  }
})

test('rechaza campos de más sin nombrarlos ni mostrar su valor', () => {
  const issues = issuesFor(with_({ token_secreto: 'valor-secreto' }))
  assert.deepEqual(issues, ['(sobre): 1 campo(s) que no son del sobre v1.'])
})

test('rechaza un campo faltante', () => {
  const missing: Partial<AuditEnvelopeV1> = { ...FIXTURE_ENVELOPE }
  delete missing.visit_id
  assert.ok(issuesFor(missing).some(issue => issue.startsWith('visit_id: ')))
})

test('el error del payload dice dónde está la falla sin mostrar el valor', () => {
  const issues = issuesFor(with_({ payload: { reason: 'motivo-privado\u0000' } }))
  assert.equal(issues.length, 1)
  assert.match(issues[0]!, /^payload: .*NUL.*\(en payload\.reason\)$/)
  assert.ok(!issues[0]!.includes('motivo-privado'))
})

test('los mensajes no incluyen los valores rechazados', () => {
  const values = ['Inventario-Privado', 'evento-secreto', 'Clave_Secreta_1']
  const issues = issuesFor(
    with_({ section_code: values[0], id: values[1], hmac_key_id: values[2] })
  )
  assert.equal(issues.length, 3)
  for (const value of values) assert.ok(!issues.join('\n').includes(value))
})
