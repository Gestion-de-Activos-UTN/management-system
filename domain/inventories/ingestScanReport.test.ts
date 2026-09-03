import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Payload } from 'payload'
import { ingestScanReport } from './ingestScanReport'
import type { AssetPayload } from '../../contracts/asset.schema'
import type { ScanReportPayload } from '../../contracts/scan-report.schema'
import type { AgentAuthResult } from '../../access/middleware/resolveAgentAuth'

const AUTH: AgentAuthResult = { agentId: 'agent-1', officeId: 'office-1', organizationId: 'org-1' }

function makeAsset(overrides: Partial<AssetPayload> = {}): AssetPayload {
  return {
    asset_id: 'a-1',
    agent_id: AUTH.agentId,
    ip: '10.0.0.1',
    mac: '',
    vendor: '',
    hostname: '',
    os: null,
    services: [],
    scan_time: '2026-01-01T00:00:00.000Z',
    os_candidates: [],
    state_reason: '',
    host_scripts: {},
    ...overrides,
  }
}

function makeService(overrides: Partial<AssetPayload['services'][number]> = {}): AssetPayload['services'][number] {
  return {
    port: 80,
    protocol: 'tcp',
    state: 'open',
    name: 'http',
    product: '',
    version: '',
    extra_info: '',
    cpe: '',
    reason: '',
    detection_method: 'table',
    confidence: 0,
    tunnel: '',
    scripts: {},
    ...overrides,
  }
}

function makeReport(assets: AssetPayload[], overrides: Partial<ScanReportPayload> = {}): ScanReportPayload {
  return {
    report_id: 'r-1',
    agent_id: AUTH.agentId,
    network: '10.0.0.0/24',
    scan_start: '2026-01-01T00:00:00.000Z',
    scan_end: '2026-01-01T00:00:01.000Z',
    hosts_up: assets.length,
    assets,
    scan_mode: 'full',
    scan_mode_reason: null,
    gateway_ip: null,
    gateway_mac: null,
    ...overrides,
  }
}

// Payload fake mínimo: solo lo que ingestScanReport toca (find/create/update sobre 'assets').
function makePayload(existingDoc: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = []
  const creates: Record<string, unknown>[] = []
  const payload = {
    async find() {
      return { docs: existingDoc ? [existingDoc] : [] }
    },
    async update({ data }: { data: Record<string, unknown> }) {
      updates.push(data)
      return { id: existingDoc?.id }
    },
    async create({ data }: { data: Record<string, unknown> }) {
      creates.push(data)
      return { id: 'new-asset' }
    },
  } as unknown as Payload
  return { payload, updates, creates }
}

// Fake más realista para los tests de reconciliación de identidad: filtra por mac/ip como lo
// hace findExistingAsset (ingestScanReport.ts) — a diferencia de makePayload() de arriba, que
// ignora `where` a propósito porque esos tests solo verifican merge/diff asumiendo que "encontrar
// el existingDoc correcto" ya pasó.
function makePayloadWithDocs(docs: Array<Record<string, unknown>>) {
  const updates: Array<{ id: unknown; data: Record<string, unknown> }> = []
  const creates: Record<string, unknown>[] = []
  const payload = {
    async find({ where }: { where: Record<string, { equals?: unknown }> }) {
      const macEquals = where.mac?.equals
      const ipEquals = where.ip?.equals
      const match = docs.find((doc) => {
        if (macEquals !== undefined && doc.mac !== macEquals) return false
        if (ipEquals !== undefined && doc.ip !== ipEquals) return false
        return true
      })
      return { docs: match ? [match] : [] }
    },
    async update({ id, data }: { id: unknown; data: Record<string, unknown> }) {
      updates.push({ id, data })
      const doc = docs.find((d) => d.id === id)
      if (doc) Object.assign(doc, data)
      return { id }
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const doc = { id: `new-${creates.length}`, ...data }
      creates.push(data)
      docs.push(doc)
      return doc
    },
  } as unknown as Payload
  return { payload, updates, creates }
}

test('reconciliación degradado→full: mismo dispositivo por ip, no duplica ni pisa datos de negocio', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    ip: '10.0.0.5',
    vendor: null,
    hostname: null,
    os: null,
    os_candidates: [],
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
    alias: 'Notebook de Gervasio',
    owner: 'user-1',
    identified: true,
    criticality: 'medium',
  }
  const { payload, updates, creates } = makePayloadWithDocs([existingDoc])

  await ingestScanReport(payload, makeReport([makeAsset({ ip: '10.0.0.5', mac: 'AA:BB:CC:DD:EE:01' })]), AUTH)

  assert.equal(creates.length, 0)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].id, 'existing-1')
  assert.equal(updates[0].data.mac, 'AA:BB:CC:DD:EE:01')
  assert.equal('alias' in updates[0].data, false)
  assert.equal('owner' in updates[0].data, false)
  assert.equal('identified' in updates[0].data, false)
  assert.equal('criticality' in updates[0].data, false)
})

test('reconciliación full→degradado: dispositivo ya con mac matchea por ip directo, sin duplicar', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: 'AA:BB:CC:DD:EE:01',
    ip: '10.0.0.5',
    vendor: null,
    hostname: null,
    os: null,
    os_candidates: [],
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates, creates } = makePayloadWithDocs([existingDoc])

  await ingestScanReport(payload, makeReport([makeAsset({ ip: '10.0.0.5', mac: '' })]), AUTH)

  assert.equal(creates.length, 0)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].id, 'existing-1')
  assert.equal(updates[0].data.mac, 'AA:BB:CC:DD:EE:01') // not-null-wins conserva la mac ya conocida
})

test('ip reasignada por DHCP a un dispositivo con otra mac: no reconcilia, crea uno nuevo', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: 'AA:BB:CC:DD:EE:01',
    ip: '10.0.0.5',
    vendor: null,
    hostname: null,
    os: null,
    os_candidates: [],
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
    alias: 'Impresora de la oficina',
  }
  const { payload, updates, creates } = makePayloadWithDocs([existingDoc])

  await ingestScanReport(payload, makeReport([makeAsset({ ip: '10.0.0.5', mac: 'FF:FF:FF:FF:FF:FF' })]), AUTH)

  assert.equal(updates.length, 0)
  assert.equal(creates.length, 1)
  assert.equal(creates[0].mac, 'FF:FF:FF:FF:FF:FF')
})

test('not-null-wins: un scan degraded (mac/vendor/hostname vacíos) no borra el valor ya conocido', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: 'AA:BB:CC:DD:EE:FF',
    vendor: 'Acme Corp',
    hostname: 'printer-01',
    os: null,
    ip: '10.0.0.1',
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates } = makePayload(existingDoc)

  await ingestScanReport(payload, makeReport([makeAsset({ mac: '', vendor: '', hostname: '' })]), AUTH)

  assert.equal(updates.length, 1)
  assert.equal(updates[0].mac, 'AA:BB:CC:DD:EE:FF')
  assert.equal(updates[0].vendor, 'Acme Corp')
  assert.equal(updates[0].hostname, 'printer-01')
})

test('dinámico (ip/services): siempre se sobreescribe aunque venga "menos lleno" que antes', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    vendor: null,
    hostname: null,
    os: null,
    ip: '10.0.0.1',
    services: [{ port: 80, protocol: 'tcp', state: 'open', name: 'http', product: '', version: '', extra_info: '', cpe: '' }],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates } = makePayload(existingDoc)

  await ingestScanReport(payload, makeReport([makeAsset({ ip: '10.0.0.2', services: [] })]), AUTH)

  assert.equal(updates[0].ip, '10.0.0.2')
  assert.deepEqual(updates[0].services, [])
})

test('hasTechnicalChanged: marca technical_changed_at solo si el activo ya fue visto y algo técnico difiere', async () => {
  const unseenDoc = {
    id: 'existing-1',
    first_viewed_at: null,
    mac: null,
    vendor: null,
    hostname: null,
    os: null,
    ip: '10.0.0.1',
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload: unseenPayload, updates: unseenUpdates } = makePayload(unseenDoc)
  await ingestScanReport(unseenPayload, makeReport([makeAsset({ ip: '10.0.0.9' })]), AUTH)
  assert.equal('technical_changed_at' in unseenUpdates[0], false)

  const seenDoc = { ...unseenDoc, first_viewed_at: '2025-01-01T00:00:00.000Z' }
  const { payload: seenPayload, updates: seenUpdates } = makePayload(seenDoc)
  await ingestScanReport(seenPayload, makeReport([makeAsset({ ip: '10.0.0.9' })]), AUTH)
  assert.equal(typeof seenUpdates[0].technical_changed_at, 'string')

  const { payload: unchangedPayload, updates: unchangedUpdates } = makePayload(seenDoc)
  await ingestScanReport(unchangedPayload, makeReport([makeAsset({ ip: '10.0.0.1' })]), AUTH)
  assert.equal('technical_changed_at' in unchangedUpdates[0], false)
})

test('hasTechnicalChanged ignora el id que Payload auto-agrega a cada fila de services', async () => {
  const service = makeService({ product: 'nginx', version: '1.25' })
  const seenDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    vendor: null,
    hostname: null,
    os: null,
    ip: '10.0.0.1',
    // Tal como lo devuelve Payload de verdad: cada fila trae un id que el payload del agente no tiene.
    services: [{ ...service, id: 'row-generated-by-payload' }],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates } = makePayload(seenDoc)

  await ingestScanReport(payload, makeReport([makeAsset({ services: [service] })]), AUTH)

  assert.equal('technical_changed_at' in updates[0], false)
})

test('os_status: indeterminate si el candidato principal no llega al 85%', async () => {
  const { payload, creates } = makePayload(null)

  await ingestScanReport(
    payload,
    makeReport([makeAsset({ os_candidates: [{ name: 'Linux', accuracy: 60, cpe: [], osfamily: 'Linux', osgen: '', vendor: '' }] })]),
    AUTH,
  )

  assert.equal(creates[0].os_status, 'indeterminate')
})

test('os_status: identified cuando el candidato principal supera el umbral (create)', async () => {
  const { payload, creates } = makePayload(null)

  await ingestScanReport(
    payload,
    makeReport([makeAsset({ os_candidates: [{ name: 'Linux', accuracy: 95, cpe: [], osfamily: 'Linux', osgen: '', vendor: '' }] })]),
    AUTH,
  )

  assert.equal(creates[0].os_status, 'identified')
})

test('os_candidates viaja con la misma política identidad que os: un scan sin osmatch no borra candidatos previos', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    vendor: null,
    hostname: null,
    os: { name: 'Linux', accuracy: 95, cpe: [] },
    os_candidates: [{ id: 'row-1', name: 'Linux', accuracy: 95, cpe: [], osfamily: 'Linux', osgen: '', vendor: '' }],
    ip: '10.0.0.1',
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates } = makePayload(existingDoc)

  await ingestScanReport(payload, makeReport([makeAsset({ os_candidates: [] })]), AUTH)

  assert.deepEqual(updates[0].os_candidates, existingDoc.os_candidates)
  assert.equal(updates[0].os_status, 'identified')
})

test('state_reason y host_scripts se sobreescriben siempre pero no cuentan como "Changed"', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    vendor: null,
    hostname: null,
    os: null,
    os_candidates: [],
    state_reason: 'arp-response',
    host_scripts: { 'smb-os-discovery': 'OS: Linux' },
    ip: '10.0.0.1',
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'active',
  }
  const { payload, updates } = makePayload(existingDoc)

  await ingestScanReport(
    payload,
    makeReport([makeAsset({ state_reason: 'echo-reply', host_scripts: {} })]),
    AUTH,
  )

  assert.equal(updates[0].state_reason, 'echo-reply')
  assert.deepEqual(updates[0].host_scripts, {})
  assert.equal('technical_changed_at' in updates[0], false)
})

test('retired es sticky: un scan nuevo no revive un activo dado de baja', async () => {
  const existingDoc = {
    id: 'existing-1',
    first_viewed_at: '2025-01-01T00:00:00.000Z',
    mac: null,
    vendor: null,
    hostname: null,
    os: null,
    ip: '10.0.0.1',
    services: [],
    gateway_ip: null,
    gateway_mac: null,
    status: 'retired',
  }
  const { payload, updates } = makePayload(existingDoc)

  await ingestScanReport(payload, makeReport([makeAsset()]), AUTH)

  assert.equal(updates[0].status, undefined)
})

test('campos técnicos obligatorios faltantes rechaza el asset sin crear/actualizar', async () => {
  const { payload, updates, creates } = makePayload(null)

  const result = await ingestScanReport(payload, makeReport([makeAsset({ asset_id: '' })]), AUTH)

  assert.equal(result.processedAssetIds.length, 0)
  assert.equal(result.rejectedAssets.length, 1)
  assert.equal(updates.length, 0)
  assert.equal(creates.length, 0)
})
