import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'

let f: ScopeFixture, agent: string, inactive: string
beforeAll(async () => {
  f = await scopeFixture('incidents')
  agent = String(
    (
      await f.payload.create({
        collection: 'agents',
        overrideAccess: true,
        context: { systemJob: true },
        data: { id: `test-${randomUUID()}`, office: f.own.second },
      })
    ).id
  )
  inactive = String(
    (
      await f.payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { name: 'Destino inactivo', organization: f.own.org, is_active: false },
      })
    ).id
  )
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
async function scenario(
  options: {
    kind?: 'location' | 'identity'
    destination?: string
    owner?: string
    status?: 'active' | 'retired'
    office?: string
    deleted?: boolean
  } = {}
) {
  const source = (
    await f.payload.find({
      collection: 'agents',
      overrideAccess: true,
      depth: 0,
      where: { office: { equals: f.own.office } },
      limit: 1,
    })
  ).docs[0]
  const asset = await f.payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `incident-${randomUUID()}`,
      agent: source.id,
      organization: f.own.org,
      office: options.office ?? f.own.office,
      ip: '10.0.0.40',
      identification_status: 'confirmed',
      identified: true,
      confirmed_type: 'server',
      authorization_status: 'authorized',
      criticality: 'medium',
      status: options.status ?? 'active',
      location_pending: true,
    },
  })
  await f.payload.update({
    collection: 'assets',
    id: asset.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: { owner: options.owner ?? f.own.viewer },
  })
  const incident = await f.payload.create({
    collection: 'inventory-incidents',
    overrideAccess: true,
    data: {
      incident_key: randomUUID(),
      organization: f.own.org,
      office: f.own.office,
      proposed_office: options.destination ?? f.own.second,
      asset: asset.id,
      agent,
      kind: options.kind ?? 'location',
      status: 'pending',
      reason: 'Detectado en otra oficina',
      observed_at: new Date().toISOString(),
    },
  })
  if (options.deleted)
    expect((await f.api(`/assets/${asset.id}`, f.own.adminCookie, 'DELETE')).status).toBe(200)
  return { asset: String(asset.id), id: String(incident.id) }
}
const resolve = (id: string, decision: unknown, cookie = f.own.adminCookie, suffix = '') =>
  f.api(`/v1/inventory-incidents/${id}/resolve${suffix}`, cookie, 'POST', decision)
const storedAsset = (id: string) =>
  f.payload.findByID({ collection: 'assets', id, depth: 0, overrideAccess: true })
const storedIncident = (id: string) =>
  f.payload.findByID({ collection: 'inventory-incidents', id, depth: 0, overrideAccess: true })
const versions = () => f.versions(['inventory-incidents', 'risk-contributions'])
for (const body of [
  { decision: 'invalid' },
  { decision: 'move', office: 'injected' },
  {},
  { decision: null },
])
  it(`rejects invalid incident input ${JSON.stringify(body)} without writes`, async () => {
    const item = await scenario()
    const before = await versions()
    expect((await resolve(item.id, body)).status).toBe(400)
    expect(await versions()).toEqual(before)
  })
for (const actor of ['anonymous', 'viewer', 'manager', 'foreign'] as const)
  it(`${actor} cannot resolve an incident outside effective authority over both offices`, async () => {
    const item = await scenario()
    const before = await versions()
    const cookie =
      actor === 'anonymous'
        ? ''
        : actor === 'foreign'
          ? f.foreign.adminCookie
          : f.own[`${actor}Cookie`]
    const result = await resolve(item.id, { decision: 'move' }, cookie)
    expect(result.status).toBe(actor === 'anonymous' ? 401 : actor === 'viewer' ? 403 : 404)
    expect(await versions()).toEqual(before)
  })
for (const [kind, decision] of [
  ['location', 'reviewed'],
  ['identity', 'move'],
  ['identity', 'keep'],
] as const)
  it(`${kind} rejects the incompatible ${decision} decision`, async () => {
    const item = await scenario({ kind })
    const before = await versions()
    const result = await resolve(item.id, { decision })
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('invalid_decision')
    expect(await versions()).toEqual(before)
  })
for (const state of ['moved', 'retired', 'deleted'] as const)
  it(`${state} asset invalidates a stale move decision with no new writes`, async () => {
    const item = await scenario({
      ...(state === 'moved'
        ? { office: f.own.second, owner: f.own.outside }
        : state === 'retired'
          ? { status: 'retired' }
          : { deleted: true }),
    })
    const before = await versions()
    const result = await resolve(item.id, { decision: 'move' })
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('asset_changed')
    expect(await versions()).toEqual(before)
  })
for (const dest of ['foreign', 'inactive'] as const)
  it(`rejects a ${dest} destination even for an organization administrator`, async () => {
    const item = await scenario({ destination: dest === 'foreign' ? f.foreign.office : inactive })
    const before = await versions()
    const result = await resolve(item.id, { decision: 'move' })
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('invalid_office')
    expect(await versions()).toEqual(before)
  })
for (const owner of ['local', 'organization', 'both'] as const)
  it(`movement persists asset, scanner and resolution together with a ${owner} owner`, async () => {
    if (owner === 'both') {
      const membership = (
        await f.payload.find({
          collection: 'organization-memberships',
          overrideAccess: true,
          where: { user: { equals: f.own.viewer } },
          limit: 1,
        })
      ).docs[0]
      await f.payload.update({
        collection: 'organization-memberships',
        id: membership.id,
        overrideAccess: true,
        data: { offices: [f.own.office, f.own.second] },
      })
    }
    const item = await scenario({ owner: owner === 'organization' ? f.own.admin : f.own.viewer })
    const result = await resolve(item.id, { decision: 'move' })
    expect(result.status, String(result.data.error ?? 'unexpected_status')).toBe(200)
    const asset = await storedAsset(item.asset)
    expect(relationId(asset.office)).toBe(f.own.second)
    expect(relationId(asset.agent)).toBe(agent)
    expect(asset.location_pending).toBe(false)
    if (owner === 'local') expect(asset.owner).toBeFalsy()
    else expect(relationId(asset.owner)).toBe(owner === 'organization' ? f.own.admin : f.own.viewer)
    const incident = await storedIncident(item.id)
    expect(incident.status).toBe('moved')
    expect(incident.resolved_at).toBeTruthy()
    expect(relationId(incident.resolved_by)).toBe(f.own.admin)
    const before = await versions()
    const repeated = await resolve(item.id, { decision: 'move' })
    expect(repeated.status).toBe(409)
    expect(repeated.data.error).toBe('already_resolved')
    expect(await versions()).toEqual(before)
  })
for (const [kind, decision, status] of [
  ['location', 'keep', 'kept'],
  ['identity', 'reviewed', 'reviewed'],
] as const)
  it(`${decision} clears the flag while preserving the asset office and scanner`, async () => {
    const item = await scenario({ kind })
    const before = await storedAsset(item.asset)
    expect((await resolve(item.id, { decision })).status).toBe(200)
    const after = await storedAsset(item.asset)
    expect(after.office).toBe(before.office)
    expect(after.agent).toBe(before.agent)
    expect(after.owner).toBe(before.owner)
    expect(after.location_pending).toBe(false)
    expect((await storedIncident(item.id)).status).toBe(status)
  })
for (const checkpoint of ['assets', 'inventory-incidents'] as const)
  it(`a failure AFTER writing ${checkpoint} rolls back both records and permits a clean retry`, async () => {
    const item = await scenario()
    const before = await versions()
    const assetBefore = await storedAsset(item.asset)
    const incidentBefore = await storedIncident(item.id)
    const original = f.payload.update.bind(f.payload)
    let written = false
    const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
      const result = (await original(args as never)) as never
      if (args.collection === checkpoint) {
        written = true
        expect(args.req?.transactionID).toBeTruthy()
        throw new Error(`Controlled failure after ${checkpoint}`)
      }
      return result
    })
    let result
    try {
      result = await resolve(item.id, { decision: 'move' })
    } finally {
      spy.mockRestore()
    }
    expect(written).toBe(true)
    expect(result.status).toBe(500)
    expect(await versions()).toEqual(before)
    expect(await storedAsset(item.asset)).toEqual(assetBefore)
    expect(await storedIncident(item.id)).toEqual(incidentBefore)
    expect((await resolve(item.id, { decision: 'move' })).status).toBe(200)
  })
for (const decision of ['keep', 'move', 'reviewed'] as const)
  it(`an active organization still permits platform ${decision}`, async () => {
    const item = await scenario({ kind: decision === 'reviewed' ? 'identity' : 'location' })
    const result = await resolve(item.id, { decision }, f.platform, `?asOrganization=${f.own.org}`)
    expect(result.status, String(result.data.error ?? 'unexpected_status')).toBe(200)
    const incident = await storedIncident(item.id)
    expect(incident.status).toBe(
      decision === 'keep' ? 'kept' : decision === 'move' ? 'moved' : 'reviewed'
    )
    expect(incident.resolved_by?.relationTo).toBe('admins')
  })

for (const decision of ['keep', 'move', 'reviewed'] as const)
  it(`${decision} response excludes credential hashes and account sessions`, async () => {
    const item = await scenario({ kind: decision === 'reviewed' ? 'identity' : 'location' })
    const result = await resolve(item.id, { decision })
    expect(result.status).toBe(200)
    function keys(value: unknown): string[] {
      if (!value || typeof value !== 'object') return []
      return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
    }
    const fields = new Set(keys(result.data))
    expect(fields.has('apiKeyHash')).toBe(false)
    expect(fields.has('sessions')).toBe(false)
    expect(result.data.agent).toBe(agent)
    expect(result.data.resolved_by.value).toBe(f.own.admin)
  })

describe('read-only platform visit to an inactive organization', () => {
  let pending: Array<{ id: string; asset: string }>
  beforeAll(async () => {
    pending = [await scenario(), await scenario(), await scenario({ kind: 'identity' })]
    await f.deactivate()
  })
  it('keeps incident history readable', async () => {
    const result = await f.api(
      `/inventory-incidents/${pending[0].id}?asOrganization=${f.own.org}`,
      f.platform
    )
    expect(result.status).toBe(200)
    expect(result.data.status).toBe('pending')
  })
  for (const [index, decision] of ['keep', 'move', 'reviewed'].entries())
    it(`blocks ${decision} without writing`, async () => {
      const before = await versions()
      const result = await resolve(
        pending[index].id,
        { decision },
        f.platform,
        `?asOrganization=${f.own.org}`
      )
      expect(result.status, String(result.data.error ?? 'unexpected_status')).toBe(409)
      expect(result.data.error).toBe('organization_inactive')
      expect(await versions()).toEqual(before)
    })
})
