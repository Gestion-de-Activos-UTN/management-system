import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'

// Datos del agente que solo ven sus lecturas directas: nunca viajan dentro de otra respuesta.
const PRIVATE_AGENT_FIELDS = [
  'apiKeyHash',
  'apiKeyPrefix',
  'failedAttempts',
  'lockedUntil',
  'lockoutCount',
]

let f: ScopeFixture, agent: string
beforeAll(async () => {
  f = await scopeFixture('agents')
  agent = String(
    (
      await f.payload.find({
        collection: 'agents',
        overrideAccess: true,
        depth: 0,
        where: { office: { equals: f.own.office } },
        limit: 1,
      })
    ).docs[0].id
  )
}, 60000)
afterAll(async () => {
  if (f) await f.payload.destroy()
})

function keys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
}
function expectNoPrivateAgentFields(value: unknown) {
  const fields = new Set(keys(value))
  for (const field of PRIVATE_AGENT_FIELDS) expect(fields.has(field), field).toBe(false)
}
async function networkAsset() {
  return f.payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `exposure-${randomUUID()}`,
      agent,
      observed_agents: [{ agent, last_seen: new Date().toISOString() }],
      organization: f.own.org,
      office: f.own.office,
      ip: '10.0.0.41',
      identification_status: 'confirmed',
      identified: true,
      confirmed_type: 'server',
      authorization_status: 'authorized',
      criticality: 'medium',
      status: 'active',
    },
  })
}

it('an agent expanded from another document carries only its public fields', async () => {
  const asset = await networkAsset()
  const expanded = await f.payload.findByID({
    collection: 'assets',
    id: asset.id,
    overrideAccess: true,
    showHiddenFields: true,
    depth: 2,
  })
  expect(expanded.agent).toMatchObject({ id: agent, lifecycle_status: expect.any(String) })
  expectNoPrivateAgentFields(expanded)
})

it('a direct agent read keeps lockout metadata and hides the hash unless asked', async () => {
  const direct = await f.payload.findByID({
    collection: 'agents',
    id: agent,
    overrideAccess: true,
    depth: 0,
  })
  expect(direct).toHaveProperty('failedAttempts')
  expect(direct.apiKeyPrefix).toBeTruthy()
  expect(direct).not.toHaveProperty('apiKeyHash')
  const withHidden = await f.payload.findByID({
    collection: 'agents',
    id: agent,
    overrideAccess: true,
    showHiddenFields: true,
    depth: 0,
  })
  expect(withHidden.apiKeyHash).toBeTruthy()
})

it('deleting a network asset answers with relation IDs and no agent internals', async () => {
  const asset = await networkAsset()
  const result = await f.api(`/assets/${asset.id}`, f.own.adminCookie, 'DELETE')
  expect(result.status, JSON.stringify(result.data)).toBe(200)
  expect(result.data.doc.agent).toBe(agent)
  expectNoPrivateAgentFields(result.data)
  const again = await f.api(`/assets/${asset.id}`, f.own.adminCookie, 'DELETE')
  expect(again.status).toBe(200)
  expect(again.data.doc.agent).toBe(agent)
})

it('a task on a network asset and its idempotent retry answer with the same body', async () => {
  const asset = await networkAsset()
  const input = {
    title: 'Revisar servidor',
    priority: 'normal',
    global: false,
    office_ids: [f.own.office],
    assignment_kind: 'open_pool',
    related_entity: { relationTo: 'assets', value: asset.id },
    operation_id: randomBytes(16).toString('hex'),
  }
  const first = await f.api('/v1/tasks', f.own.adminCookie, 'POST', input)
  expect(first.status, JSON.stringify(first.data)).toBe(201)
  const retry = await f.api('/v1/tasks', f.own.adminCookie, 'POST', input)
  expect(retry.status).toBe(201)
  expect(retry.data).toEqual(first.data)
  expect(first.data.docs[0].related_entity.value).toBe(asset.id)
  expectNoPrivateAgentFields(first.data)
})
