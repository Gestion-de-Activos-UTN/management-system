import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecretKey } from 'node:crypto'
import { AuditEnvelopeError } from './envelope'
import { FIXTURE_ENVELOPE, FIXTURE_KEY_HEX, FIXTURE_NETWORK_CONTEXT } from './envelope.fixture'
import {
  AUDIT_EVENT_HASH_LABEL,
  AUDIT_NETWORK_DIGEST_LABEL,
  AuditKeyMissingError,
  chainHashInput,
  computeChainHash,
  computeNetworkDigest,
  hashesEqual,
  networkDigestInput,
} from './hmac'

const KEYS = new Map([
  ['test-2026-11', createSecretKey(Buffer.from(FIXTURE_KEY_HEX, 'hex'))],
  ['test-2026-12', createSecretKey(Buffer.alloc(32, 0xaa))],
])

// Texto exacto que se firma: etiqueta, salto de línea y el JSON canónico del sobre de
// envelope.fixture.ts (claves ordenadas, sin espacios, UTF-8). Escrito a mano, no calculado.
const EXPECTED_EVENT_INPUT =
  'siam.audit.event.v1\n' +
  '{"action_code":"scan.rename","actor_collection":"users","actor_id":"5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170",' +
  '"actor_role":"org_admin","actor_type":"user","category_code":"inventory_evidence",' +
  '"chain_id":"org:0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e","created_at":"2026-11-22T21:05:39.123Z",' +
  '"entity_id":"7d3e9f10-2b4c-4d6e-a8f0-123456789abc","entity_type":"scan_report","hmac_key_id":"test-2026-11",' +
  '"id":"3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e6f","initiated_by_id":null,"initiated_by_type":null,' +
  '"network_digest":"b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184",' +
  '"network_expires_at":"2027-11-22T21:05:39.123Z","occurred_at":null,' +
  '"office_ids":["1a2b3c4d-0000-4000-8000-000000000001","1a2b3c4d-0000-4000-8000-000000000002"],' +
  '"operation_id":"9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d","organization_id":"0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e",' +
  '"origin":"interactive","outcome":"success","parent_event_id":null,' +
  '"payload":{"changes":[{"after":{"state":"value","value":"Escaneo oficina Ñandú"},' +
  '"before":{"state":"value","value":"Escaneo 1"},"field":"display_name"}],' +
  '"entity_snapshot":{"label":"Escaneo oficina Ñandú"}},' +
  '"previous_hash":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",' +
  '"schema_version":1,"scope_kind":"organization","section_code":"inventory","sequence":2,"visit_id":null}'

// Calculado aparte con OpenSSL 3 (no con este código), con la clave 0x00…0x1f:
//   printf '%s\n%s' 'siam.audit.event.v1' '<el JSON de EXPECTED_EVENT_INPUT, en una línea>' \
//     | openssl dgst -sha256 -mac HMAC -macopt hexkey:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
const EXPECTED_CHAIN_HASH = '744a52e8062aac5600679093546d51fbaec82238d6359c2b3d6cfccaa6fee6ef'

const EXPECTED_NETWORK_INPUT =
  'siam.audit.network.v1\n' +
  '{"chain_id":"org:0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e",' +
  '"context":{"captured_at":"2026-11-22T21:05:39.123Z","family":"ipv4","ip":"203.0.113.7","source":"trusted_proxy"},' +
  '"event_id":"3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e6f"}'

// Igual que el anterior, con 'siam.audit.network.v1' y el JSON de EXPECTED_NETWORK_INPUT.
const EXPECTED_NETWORK_DIGEST = '0c2353173d40f30432311a18e2971dba43fdbbb7031fd17ebca1adb5380a5c6a'

const NETWORK = {
  chain_id: FIXTURE_ENVELOPE.chain_id,
  event_id: FIXTURE_ENVELOPE.id,
  context: FIXTURE_NETWORK_CONTEXT,
}

test('el texto firmado del sobre es exactamente el esperado', () => {
  assert.equal(chainHashInput(FIXTURE_ENVELOPE), EXPECTED_EVENT_INPUT)
  assert.ok(EXPECTED_EVENT_INPUT.startsWith(`${AUDIT_EVENT_HASH_LABEL}\n`))
})

test('chain_hash del sobre de ejemplo coincide con el de OpenSSL', () => {
  assert.equal(computeChainHash(FIXTURE_ENVELOPE, KEYS), EXPECTED_CHAIN_HASH)
})

test('network_digest coincide con el de OpenSSL', () => {
  assert.equal(networkDigestInput(NETWORK), EXPECTED_NETWORK_INPUT)
  assert.ok(EXPECTED_NETWORK_INPUT.startsWith(`${AUDIT_NETWORK_DIGEST_LABEL}\n`))
  assert.equal(computeNetworkDigest(NETWORK, 'test-2026-11', KEYS), EXPECTED_NETWORK_DIGEST)
})

test('cambiar cualquier campo del sobre cambia chain_hash', () => {
  // Cada parche deja el sobre válido. Los campos que dependen entre sí van juntos.
  const patches: Record<string, Record<string, unknown>> = {
    id: { id: '3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e70' },
    scope: {
      scope_kind: 'platform',
      chain_id: 'platform',
      organization_id: null,
      office_ids: [],
    },
    organization: {
      organization_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      chain_id: 'org:1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    },
    office_ids: { office_ids: [FIXTURE_ENVELOPE.office_ids[0]] },
    sequence: { sequence: 3 },
    created_at: { created_at: '2026-11-22T21:05:39.124Z' },
    occurred_at: { occurred_at: '2026-11-22T21:00:00.000Z' },
    category: { category_code: 'task_creation', action_code: 'task.create' },
    action_code: { action_code: 'snapshot.rename' },
    section_code: { section_code: 'tasks' },
    entity_type: { entity_type: 'inventory_snapshot' },
    entity_id: { entity_id: '7d3e9f10-2b4c-4d6e-a8f0-123456789abd' },
    actor_type: { actor_type: 'platform_admin', actor_collection: 'admins' },
    actor_id: { actor_id: '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928171' },
    actor_role: { actor_role: 'office_manager' },
    initiated_by: { initiated_by_type: 'agent', initiated_by_id: 'agent-1' },
    operation_id: { operation_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e' },
    parent_event_id: { parent_event_id: '2b3c4d5e-6f70-4182-9a3b-4c5d6e7f8091' },
    visit_id: { visit_id: '4d5e6f70-8192-4a3b-8c4d-5e6f70819203' },
    origin: { origin: 'job' },
    outcome: { outcome: 'failed' },
    payload: { payload: { ...FIXTURE_ENVELOPE.payload, entity_snapshot: { label: 'Otro' } } },
    network_digest: { network_digest: 'c'.repeat(64) },
    network_expires_at: { network_expires_at: '2027-11-22T21:05:39.124Z' },
    hmac_key_id: { hmac_key_id: 'test-2026-12' },
    previous_hash: { previous_hash: 'd'.repeat(64) },
  }

  // Si se agrega un campo al sobre sin agregar su parche, este test falla.
  const touched = new Set(Object.values(patches).flatMap(patch => Object.keys(patch)))
  const fields = Object.keys(FIXTURE_ENVELOPE).filter(field => field !== 'schema_version')
  assert.deepEqual([...touched].sort(), fields.sort())

  const hashes = new Map<string, string>([['original', EXPECTED_CHAIN_HASH]])
  for (const [name, patch] of Object.entries(patches)) {
    const hash = computeChainHash({ ...FIXTURE_ENVELOPE, ...patch }, KEYS)
    for (const [other, otherHash] of hashes) assert.notEqual(hash, otherHash, `${name} = ${other}`)
    hashes.set(name, hash)
  }
})

test('schema_version no se puede cambiar: el sobre v1 solo admite 1', () => {
  assert.throws(
    () => computeChainHash({ ...FIXTURE_ENVELOPE, schema_version: 2 }, KEYS),
    AuditEnvelopeError
  )
})

test('cambiar la versión de clave cambia el hash (rotación)', () => {
  const rotated = { ...FIXTURE_ENVELOPE, hmac_key_id: 'test-2026-12' }
  assert.notEqual(computeChainHash(rotated, KEYS), EXPECTED_CHAIN_HASH)
  // Mismo texto con la clave nueva ≠ mismo texto con la clave vieja: la clave pesa, no solo el id.
  const sameIdOtherKey = new Map([['test-2026-11', KEYS.get('test-2026-12')!]])
  assert.notEqual(computeChainHash(FIXTURE_ENVELOPE, sameIdOtherKey), EXPECTED_CHAIN_HASH)
})

test('una versión de clave ausente es un error propio, distinto de un hash incorrecto', () => {
  const error = (() => {
    try {
      computeChainHash({ ...FIXTURE_ENVELOPE, hmac_key_id: 'test-2027-01' }, KEYS)
    } catch (caught) {
      return caught
    }
  })()
  assert.ok(error instanceof AuditKeyMissingError)
  assert.equal(error.keyId, 'test-2027-01')
  assert.ok(!error.message.includes(FIXTURE_KEY_HEX))
  assert.throws(() => computeNetworkDigest(NETWORK, 'test-2027-01', KEYS), AuditKeyMissingError)
})

test('un sobre inválido no se firma', () => {
  assert.throws(() => computeChainHash({ ...FIXTURE_ENVELOPE, extra: 1 }, KEYS), AuditEnvelopeError)
  assert.throws(() => chainHashInput({ ...FIXTURE_ENVELOPE, sequence: 0 }), AuditEnvelopeError)
})

test('el digest de red depende del evento y de la cadena, no solo de la IP', () => {
  const digest = (patch: object) =>
    computeNetworkDigest({ ...NETWORK, ...patch }, 'test-2026-11', KEYS)
  const otherEvent = digest({ event_id: '3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e70' })
  const otherChain = digest({ chain_id: 'org:1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' })
  const otherIp = digest({ context: { ...FIXTURE_NETWORK_CONTEXT, ip: '203.0.113.8' } })
  assert.equal(new Set([EXPECTED_NETWORK_DIGEST, otherEvent, otherChain, otherIp]).size, 4)
})

test('las etiquetas separan los dos usos de la clave', () => {
  assert.notEqual(AUDIT_EVENT_HASH_LABEL, AUDIT_NETWORK_DIGEST_LABEL)
  assert.notEqual(EXPECTED_CHAIN_HASH, EXPECTED_NETWORK_DIGEST)
})

test('hashesEqual compara el largo antes y no lanza con largos distintos', () => {
  assert.equal(hashesEqual(EXPECTED_CHAIN_HASH, EXPECTED_CHAIN_HASH), true)
  assert.equal(hashesEqual(EXPECTED_CHAIN_HASH, `${EXPECTED_CHAIN_HASH.slice(0, -1)}0`), false)
  assert.equal(hashesEqual(EXPECTED_CHAIN_HASH, EXPECTED_CHAIN_HASH.slice(0, -1)), false)
  assert.equal(hashesEqual(EXPECTED_CHAIN_HASH, ''), false)
  assert.equal(hashesEqual('', ''), true)
  // Mismo largo en caracteres (1), distinto en bytes: 'ñ' ocupa 2 en UTF-8. Comparar
  // string.length no alcanza: timingSafeEqual lanzaría.
  assert.equal(hashesEqual('a', 'ñ'), false)
})
