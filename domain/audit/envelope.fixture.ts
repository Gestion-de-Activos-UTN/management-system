import type { AuditEnvelopeV1 } from './envelope'

// Datos fijos para los tests del sobre y del HMAC (no son secretos). El texto canónico y los
// hashes esperados están escritos a mano en hmac.test.ts y se pueden recalcular con openssl.
// Sin comillas simples ni caracteres de control, para que el comando de shell sea simple.

/** Clave HMAC de prueba: los bytes 0x00…0x1f (hex 000102…1f). */
export const FIXTURE_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'

export const FIXTURE_ENVELOPE: AuditEnvelopeV1 = {
  schema_version: 1,
  id: '3f1c2a8e-5b7d-4e9a-8c6f-1a2b3c4d5e6f',
  scope_kind: 'organization',
  chain_id: 'org:0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e',
  organization_id: '0b6e2d4a-9c1f-4a3b-9d8e-7f6a5b4c3d2e',
  office_ids: ['1a2b3c4d-0000-4000-8000-000000000001', '1a2b3c4d-0000-4000-8000-000000000002'],
  sequence: 2,
  created_at: '2026-11-22T21:05:39.123Z',
  occurred_at: null,
  category_code: 'inventory_evidence',
  action_code: 'scan.rename',
  section_code: 'inventory',
  entity_type: 'scan_report',
  entity_id: '7d3e9f10-2b4c-4d6e-a8f0-123456789abc',
  actor_type: 'user',
  actor_id: '5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170',
  actor_collection: 'users',
  actor_role: 'org_admin',
  initiated_by_type: null,
  initiated_by_id: null,
  operation_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  parent_event_id: null,
  visit_id: null,
  origin: 'interactive',
  outcome: 'success',
  payload: {
    entity_snapshot: { label: 'Escaneo oficina Ñandú' },
    changes: [
      {
        field: 'display_name',
        before: { state: 'value', value: 'Escaneo 1' },
        after: { state: 'value', value: 'Escaneo oficina Ñandú' },
      },
    ],
  },
  network_digest: 'b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184',
  network_expires_at: '2027-11-22T21:05:39.123Z',
  hmac_key_id: 'test-2026-11',
  previous_hash: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
}

/** Contexto de red de prueba para el digest (su esquema real se define en el paso 4). */
export const FIXTURE_NETWORK_CONTEXT = {
  source: 'trusted_proxy',
  ip: '203.0.113.7',
  family: 'ipv4',
  captured_at: '2026-11-22T21:05:39.123Z',
}
