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

test('POST /v1/reports rechaza token inválido', async () => {
  const payload = await getPayload({ config })
  await seedAgent(payload)

  const res = await reportsEndpoint.handler(
    fakeRequest(payload, { authorization: 'Bearer not-a-real-token' }, reportPayload()),
  )
  assert.equal(res.status, 401)
})
