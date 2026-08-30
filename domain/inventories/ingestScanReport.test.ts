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
