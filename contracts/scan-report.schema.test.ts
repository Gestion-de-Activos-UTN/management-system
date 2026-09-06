import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ScanReportPayloadSchema } from './scan-report.schema'

// Payload sintético con la forma que scanner-prototype/src/siam_agent/models.py declara.
// No se usa data/resultados/scan_*.json real: esos dumps quedaron capturados con el bug
// de anidamiento en OperatingSystem.cpe (ver scanner-prototype/src/siam_agent/scanner.py::_parse_os,
// ya corregido, con regresión en scanner-prototype/tests/test_scanner.py) — no representan
// el contrato correcto y no deben congelarse como fixture de este test.
function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    report_id: 'r-1',
    agent_id: 'agent-001',
    network: '192.168.0.0/24',
    scan_start: '2026-07-24T23:46:07.521139+00:00',
    scan_end: '2026-07-24T23:51:45.251990+00:00',
    hosts_up: 1,
    assets: [
      {
        asset_id: 'a-1',
        agent_id: 'agent-001',
        ip: '192.168.0.1',
        mac: '44:D4:54:B8:9E:CE',
        vendor: 'Sagemcom Broadband SAS',
        hostname: 'Docsis-Gateway',
        os: {
          name: 'Linux',
          accuracy: 95,
          cpe: ['cpe:/o:linux:linux_kernel:3'],
          osfamily: 'Linux',
          osgen: '',
          vendor: '',
          device_type: 'router',
        },
        services: [
          {
            port: 80,
            protocol: 'tcp',
            state: 'open',
            name: 'http',
            product: 'nginx',
            version: '1.25',
            extra_info: '',
            cpe: '',
            reason: 'syn-ack',
            detection_method: 'probed',
            confidence: 10,
            tunnel: '',
            scripts: {},
          },
        ],
        scan_time: '2026-07-24T23:51:45.039267+00:00',
        os_candidates: [],
        state_reason: 'arp-response',
        host_scripts: {},
        names: [{ value: 'Docsis-Gateway', source: 'ptr' }],
        mac_metadata: { kind: 'globally_administered', vendor_resolution: 'resolved' },
        asset_coverage: {
          port_scan: 'complete',
          service_detection: 'complete',
          os_detection: 'complete',
          name_resolution: 'complete',
        },
        scan_issues: [],
      },
    ],
    scan_mode: 'full',
    scan_mode_reason: null,
    execution_status: 'completed',
    scanner_interfaces: [],
    report_coverage: {
      schema_version: 1,
      profile: 'siam_standard_v1',
      discovery: { status: 'complete', methods_attempted: ['arp'] },
      ports: [{ protocol: 'tcp', port_spec: '1-1000', status: 'complete' }],
      service_detection: { status: 'complete' },
      os_detection: { status: 'complete' },
      name_resolution: { status: 'complete', methods_attempted: ['ptr'] },
      limitations: [],
    },
    gateway_ip: null,
    gateway_mac: null,
    ...overrides,
  }
}

test('un ScanReport con la forma de models.py pasa el schema sin transformarse', () => {
  const raw = buildReport()
  const parsed = ScanReportPayloadSchema.parse(raw)
  assert.equal(parsed.report_id, raw.report_id)
  assert.equal(parsed.assets.length, raw.assets.length)
})

test('rechaza si falta un campo requerido del bloque técnico', () => {
  const raw = buildReport()
  delete (raw.assets[0] as Record<string, unknown>).ip
  assert.throws(() => ScanReportPayloadSchema.parse(raw))
})

test('rechaza un campo extra desconocido', () => {
  const raw = buildReport()
  ;(raw.assets[0] as Record<string, unknown>).future_field = 'algo que un agente más nuevo mande'
  assert.throws(() => ScanReportPayloadSchema.parse(raw))
})

test('rechaza un reporte sin cobertura obligatoria', () => {
  const raw = buildReport()
  delete (raw as Record<string, unknown>).report_coverage
  assert.throws(() => ScanReportPayloadSchema.parse(raw))
})

test('acepta scan_mode degraded con su razón', () => {
  const raw = buildReport({
    scan_mode: 'degraded',
    scan_mode_reason: 'sin permisos root para raw sockets',
  })
  raw.report_coverage.os_detection.status = 'not_attempted'
  raw.assets[0].asset_coverage.os_detection = 'not_attempted'
  const parsed = ScanReportPayloadSchema.parse(raw)
  assert.equal(parsed.scan_mode, 'degraded')
  assert.equal(parsed.scan_mode_reason, 'sin permisos root para raw sockets')
})

test('acepta gateway desconocido expresado como null', () => {
  const parsed = ScanReportPayloadSchema.parse(buildReport())
  assert.equal(parsed.gateway_ip, null)
  assert.equal(parsed.gateway_mac, null)
})

test('acepta gateway_ip/gateway_mac cuando el agente pudo resolverlos', () => {
  const parsed = ScanReportPayloadSchema.parse(
    buildReport({ gateway_ip: '192.168.0.1', gateway_mac: 'AA:BB:CC:DD:EE:FF' })
  )
  assert.equal(parsed.gateway_ip, '192.168.0.1')
  assert.equal(parsed.gateway_mac, 'AA:BB:CC:DD:EE:FF')
})

test('rechaza hosts_up inconsistente con assets', () => {
  assert.throws(() => ScanReportPayloadSchema.parse(buildReport({ hosts_up: 2 })))
})

test('rechaza scan_mode degraded sin razón', () => {
  assert.throws(() =>
    ScanReportPayloadSchema.parse(buildReport({ scan_mode: 'degraded', scan_mode_reason: null }))
  )
})
