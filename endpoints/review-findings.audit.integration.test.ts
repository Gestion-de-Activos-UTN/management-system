import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { handleEndpoints } from 'payload'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'

let f: ScopeFixture

async function agent() {
  const created = await f.payload.create({
    collection: 'agents',
    overrideAccess: true,
    data: { id: `agent-${randomUUID()}`, office: f.own.office },
  })
  return { id: String(created.id), apiKey: created.apiKey as string }
}
async function heartbeat(scanner: { id: string; apiKey: string }) {
  const response = await handleEndpoints({
    config: f.payload.config,
    request: new Request('http://localhost/api/v1/heartbeat', {
      method: 'POST',
      headers: { authorization: `Bearer ${scanner.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        agent_id: scanner.id,
        status: 'idle',
        timestamp: new Date().toISOString(),
      }),
    }),
  })
  return { status: response.status, body: await response.text() }
}
const saved = (id: string) =>
  f.payload.findByID({
    collection: 'agents',
    id,
    overrideAccess: true,
    showHiddenFields: true,
    depth: 0,
  })
/** Lets one agents update fail with `error` before reaching the database. */
function failNextAgentUpdate(error: () => Promise<never>) {
  const original = f.payload.update.bind(f.payload)
  const spy = vi.spyOn(f.payload, 'update').mockImplementation((async (args: any) => {
    if (args.collection !== 'agents') return original(args)
    spy.mockRestore()
    return error()
  }) as never)
}
async function ownAsset() {
  const found = await f.payload.find({
    collection: 'assets',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { organization: { equals: f.own.org } },
  })
  return found.docs[0]
}

beforeAll(async () => {
  f = await scopeFixture('findings')
}, 60000)
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  if (f) await f.payload.destroy()
})

it('heartbeat: a transient database failure is a retryable server error, never a revocation', async () => {
  const scanner = await agent()
  expect((await heartbeat(scanner)).status).toBe(200)
  failNextAgentUpdate(async () => {
    throw new Error('connection terminated unexpectedly')
  })
  const failed = await heartbeat(scanner)
  expect(failed.status).toBe(500)
  expect(failed.body).not.toContain('agent revoked')
  expect((await saved(scanner.id)).lifecycle_status).toBe('active')
  expect((await heartbeat(scanner)).status).toBe(200)
})

it('heartbeat: an agent revoked during the request stays revoked and the next heartbeat stops it', async () => {
  const scanner = await agent()
  const original = f.payload.update.bind(f.payload)
  const spy = vi.spyOn(f.payload, 'update').mockImplementation((async (args: any) => {
    if (args.collection !== 'agents') return original(args)
    spy.mockRestore()
    const revoked = await f.api(`/v1/agents/${scanner.id}/revoke`, f.own.adminCookie, 'POST', {})
    expect(revoked.status).toBe(200)
    return original(args)
  }) as never)
  expect((await heartbeat(scanner)).status).toBe(200)
  expect((await saved(scanner.id)).lifecycle_status).toBe('revoked')
  const next = await heartbeat(scanner)
  expect(next.status).toBe(401)
  expect(JSON.parse(next.body)).toEqual({ error: 'agent revoked' })
})

it('revoke: neither the first nor a repeated revocation returns the credential hash', async () => {
  const scanner = await agent()
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.api(`/v1/agents/${scanner.id}/revoke`, f.own.adminCookie, 'POST', {})
    expect(result.status).toBe(200)
    expect(result.data.lifecycle_status).toBe('revoked')
    expect(result.data).not.toHaveProperty('apiKeyHash')
  }
  expect((await saved(scanner.id)).apiKeyHash).toBeTruthy()
})

it('assets: a generic PATCH cannot change the identification fields', async () => {
  const asset = await ownAsset()
  expect(
    (await f.api(`/v1/assets/${asset.id}/unidentify`, f.own.adminCookie, 'PATCH', {})).status
  ).toBe(200)
  for (const cookie of [f.own.adminCookie, f.own.managerCookie]) {
    await f.api(`/assets/${asset.id}`, cookie, 'PATCH', {
      identified: true,
      identification_status: 'confirmed',
    })
    const current = await f.payload.findByID({
      collection: 'assets',
      id: asset.id,
      overrideAccess: true,
      depth: 0,
    })
    expect(current.identified).toBe(false)
    expect(current.identification_status).toBe('pending')
  }
})

it('assets: the dedicated endpoints still identify and unidentify', async () => {
  const asset = await ownAsset()
  const identified = await f.api(`/v1/assets/${asset.id}/identify`, f.own.adminCookie, 'PATCH', {
    confirmed_type: 'server',
    authorization_status: 'authorized',
  })
  expect(identified.status, JSON.stringify(identified.data)).toBe(200)
  let current = await f.payload.findByID({
    collection: 'assets',
    id: asset.id,
    overrideAccess: true,
  })
  expect(current.identified).toBe(true)
  expect(current.identification_status).toBe('confirmed')
  await f.api(`/assets/${asset.id}`, f.own.adminCookie, 'PATCH', {
    identified: false,
    identification_status: 'pending',
  })
  current = await f.payload.findByID({ collection: 'assets', id: asset.id, overrideAccess: true })
  expect(current.identified).toBe(true)
  expect(
    (await f.api(`/v1/assets/${asset.id}/unidentify`, f.own.adminCookie, 'PATCH', {})).status
  ).toBe(200)
  current = await f.payload.findByID({ collection: 'assets', id: asset.id, overrideAccess: true })
  expect(current.identified).toBe(false)
})

it('members: names reach every member, emails only people who manage members', async () => {
  for (const [actor, cookie, seesEmail] of [
    ['viewer', f.own.viewerCookie, false],
    ['manager', f.own.managerCookie, true],
    ['admin', f.own.adminCookie, true],
    ['visiting platform', `${f.platform}`, true],
  ] as const) {
    const suffix = actor === 'visiting platform' ? `?asOrganization=${f.own.org}` : ''
    const result = await f.api(`/v1/org-members${suffix}`, cookie)
    expect(result.status, actor).toBe(200)
    expect(result.data.docs.length, actor).toBeGreaterThan(0)
    for (const row of result.data.docs) {
      expect(row.name, actor).toBeTruthy()
      expect('email' in row, actor).toBe(seesEmail)
      expect(Array.isArray(row.office_names), actor).toBe(true)
    }
  }
})

it('members: office names only include offices the viewer can see', async () => {
  const result = await f.api('/v1/org-members', f.own.viewerCookie)
  expect(result.status).toBe(200)
  const offices = await f.payload.find({
    collection: 'offices',
    overrideAccess: true,
    depth: 0,
    where: { id: { in: [f.own.office, f.own.second] } },
  })
  const name = (id: string) => offices.docs.find(office => String(office.id) === id)!.name
  // The admin works in both offices; the viewer only in the first one.
  const admin = result.data.docs.find((row: { id: string }) => row.id === f.own.admin)
  expect(admin.office_names).toEqual([name(f.own.office)])
  expect(admin.office_names).not.toContain(name(f.own.second))
})

it('task assignment options apply the same email rule and name visible offices', async () => {
  for (const [actor, cookie] of [
    ['manager', f.own.managerCookie],
    ['admin', f.own.adminCookie],
    ['visiting platform', `${f.platform}`],
  ] as const) {
    const suffix = actor === 'visiting platform' ? `&asOrganization=${f.own.org}` : ''
    const result = await f.api(
      `/v1/tasks/assignment-options?office_id=${f.own.office}${suffix}`,
      cookie
    )
    expect(result.status, actor).toBe(200)
    expect(result.data.users.length, actor).toBeGreaterThan(0)
    for (const row of result.data.users) {
      expect('email' in row, actor).toBe(true)
      expect(Array.isArray(row.office_names), actor).toBe(true)
    }
  }
  const viewer = await f.api(
    `/v1/tasks/assignment-options?office_id=${f.own.office}`,
    f.own.viewerCookie
  )
  expect(viewer.status).toBe(403)
})
