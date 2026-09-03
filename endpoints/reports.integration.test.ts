import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { reportsEndpoint } from './reports'

// Integration test real: pega contra Payload's Local API con Postgres real (requiere
// DATABASE_URL, ver package.json::test:integration). No usa raw HTTP — construye un
// PayloadRequest mínimo (headers + json(), el único contrato que el handler usa) y llama
// directo al handler exportado, tal como pide SYSTEM_PROMPT.md §8.

function fakeRequest(payload: Payload, headers: Record<string, string>, body: unknown) {
  return {
    payload,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as PayloadRequest
}

function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    report_id: `r-${Math.random().toString(36).slice(2)}`,
    agent_id: 'agent-001',
    network: '192.168.0.0/24',
    scan_start: '2026-07-24T23:46:07.521139+00:00',
    scan_end: '2026-07-24T23:51:45.251990+00:00',
    hosts_up: 1,
    assets: [
      {
        asset_id: `a-${Math.random().toString(36).slice(2)}`,
        agent_id: 'agent-001',
        ip: '192.168.0.1',
        mac: '44:D4:54:B8:9E:CE',
        vendor: 'Sagemcom Broadband SAS',
        hostname: 'Docsis-Gateway',
        os: null,
        services: [],
        scan_time: '2026-07-24T23:51:45.039267+00:00',
      },
    ],
    ...overrides,
  }
}

async function seedAgent(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Test' },
    overrideAccess: true,
  })
  const agent = await payload.create({
    collection: 'agents',
    data: { id: 'agent-001', office: office.id },
    overrideAccess: true,
  })
  return { organization, office, apiKey: agent.apiKey as string }
}

test('POST /v1/reports crea assets y es idempotente por report_id', async () => {
  const payload = await getPayload({ config })
  const { apiKey } = await seedAgent(payload)
  const body = reportPayload()

  const first = await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: `Bearer ${apiKey}`, 'x-agent-id': 'agent-001' }, body),
  )
  assert.equal(first.status, 200)
  const firstJson = await first.json()
  assert.equal(firstJson.processed, 1)

  const asset = await payload.find({
    collection: 'assets',
    where: { asset_id: { equals: body.assets[0].asset_id } },
    overrideAccess: true,
  })
  assert.equal(asset.docs.length, 1)

  const second = await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: `Bearer ${apiKey}`, 'x-agent-id': 'agent-001' }, body),
  )
  assert.equal(second.status, 200)
  const secondJson = await second.json()
  assert.equal(secondJson.status, 'processed')

  const assetsAfterRetry = await payload.find({
    collection: 'assets',
    where: { asset_id: { equals: body.assets[0].asset_id } },
    overrideAccess: true,
  })
  assert.equal(assetsAfterRetry.docs.length, 1, 'no debe duplicar el asset en el reintento')
})

test('POST /v1/reports reconcilia un scan degradado seguido de uno full: mismo doc, sin perder alias/owner/status', async () => {
  // Reproduce el bug real (visto en datos de dev): scan sin sudo -> asset_id sale de la IP (mac
  // vacía). Un humano identifica el activo y le pone alias/status. Scan siguiente CON sudo ->
  // mac se resuelve -> asset_id hash distinto -> antes de este fix, ingestScanReport.ts no lo
  // encontraba por asset_id y creaba un documento nuevo, huérfano de esos datos de negocio.
  const payload = await getPayload({ config })
  const { apiKey } = await seedAgent(payload)
  const degradedAssetId = `a-degraded-${Math.random().toString(36).slice(2)}`
  const fullAssetId = `a-full-${Math.random().toString(36).slice(2)}`

  const degradedBody = reportPayload({
    scan_mode: 'degraded',
    assets: [
      {
        asset_id: degradedAssetId,
        agent_id: 'agent-001',
        ip: '192.168.0.77',
        mac: '',
        vendor: '',
        hostname: '',
        os: null,
        services: [],
        scan_time: '2026-07-24T23:51:45.039267+00:00',
      },
    ],
  })
  await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: `Bearer ${apiKey}`, 'x-agent-id': 'agent-001' }, degradedBody),
  )

  const created = await payload.find({
    collection: 'assets',
    where: { ip: { equals: '192.168.0.77' } },
    overrideAccess: true,
  })
  assert.equal(created.docs.length, 1)
  await payload.update({
    collection: 'assets',
    id: created.docs[0].id,
    overrideAccess: true,
    data: { alias: 'Notebook de Gervasio', identified: true, status: 'retired' },
  })

  const fullBody = reportPayload({
    scan_mode: 'full',
    assets: [
      {
        asset_id: fullAssetId,
        agent_id: 'agent-001',
        ip: '192.168.0.77',
        mac: 'AA:BB:CC:DD:EE:77',
        vendor: 'Acme',
        hostname: 'gervasio-nb',
        os: null,
        services: [],
        scan_time: '2026-07-24T23:55:00.000000+00:00',
      },
    ],
  })
  await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: `Bearer ${apiKey}`, 'x-agent-id': 'agent-001' }, fullBody),
  )

  const afterFull = await payload.find({
    collection: 'assets',
    where: { ip: { equals: '192.168.0.77' } },
    overrideAccess: true,
  })
  assert.equal(afterFull.docs.length, 1, 'no debe duplicar el asset al resolverse la mac')
  assert.equal(afterFull.docs[0].id, created.docs[0].id, 'debe ser el mismo documento')
  assert.equal(afterFull.docs[0].mac, 'AA:BB:CC:DD:EE:77')
  assert.equal(afterFull.docs[0].alias, 'Notebook de Gervasio')
  assert.equal(afterFull.docs[0].identified, true)
  assert.equal(afterFull.docs[0].status, 'retired', 'retired es sticky, un scan nuevo no lo revive')
})

test('POST /v1/reports NO rechaza un host sin mac/vendor/hostname resueltos', async () => {
  // Caso real: nmap manda "" (no null) para mac/vendor/hostname cuando el host está fuera del
  // segmento L2 del agente (notebooks/celulares por WiFi en otro subnet) — doc 05 §5.1 los marca
  // "Técnicos opcionales" a propósito. Antes de este fix, ingestScanReport.ts los exigía y
  // descartaba en silencio exactamente estos hosts (regresión real reportada por el usuario:
  // "solo veo dos activos" contra la plataforma vs. muchos más en el JSON local sin filtrar).
  const payload = await getPayload({ config })
  const { apiKey } = await seedAgent(payload)
  const body = reportPayload({
    assets: [
      {
        asset_id: `a-${Math.random().toString(36).slice(2)}`,
        agent_id: 'agent-001',
        ip: '192.168.0.42',
        mac: '',
        vendor: '',
        hostname: '',
        os: null,
        services: [],
        scan_time: '2026-07-24T23:51:45.039267+00:00',
      },
    ],
  })

  const res = await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: `Bearer ${apiKey}`, 'x-agent-id': 'agent-001' }, body),
  )
  assert.equal(res.status, 200)
  const resJson = await res.json()
  assert.equal(resJson.processed, 1)
  assert.deepEqual(resJson.rejected, [])

  const asset = await payload.find({
    collection: 'assets',
    where: { asset_id: { equals: body.assets[0].asset_id } },
    overrideAccess: true,
  })
  assert.equal(asset.docs.length, 1)
  assert.equal(asset.docs[0].mac, null)
  assert.equal(asset.docs[0].vendor, null)
  assert.equal(asset.docs[0].hostname, null)
})

test('POST /v1/reports rechaza token inválido', async () => {
  const payload = await getPayload({ config })
  await seedAgent(payload)

  const res = await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: 'Bearer not-a-real-token' }, reportPayload()),
  )
  assert.equal(res.status, 401)
})
