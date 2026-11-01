import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'

let f: ScopeFixture
let move: string, retire: string, name: string, inactive: string
beforeAll(async () => {
  f = await scopeFixture('offices')
  name = (
    await f.payload.findByID({ collection: 'offices', id: f.own.office, overrideAccess: true })
  ).name
  inactive = String(
    (
      await f.payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { name: 'Destino inactivo', organization: f.own.org, is_active: false },
      })
    ).id
  )
  move = (await f.createManual(f.own, { location: 'Recepción' })).id
  retire = (await f.createManual(f.own, { asset_category: 'printer' })).id
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
async function impact() {
  const result = await f.api(`/v1/offices/${f.own.office}/deactivation-impact`, f.own.adminCookie)
  expect(result.status).toBe(200)
  return result.data
}
function input() {
  return {
    is_active: false,
    confirm_name: name,
    manual_asset_decisions: [
      { asset_id: move, destination: f.own.second },
      { asset_id: retire, destination: 'retire' },
    ],
  }
}
const save = (body: unknown) =>
  f.api(`/v1/offices/${f.own.office}/status`, f.own.adminCookie, 'POST', body)
it('impact includes both live assets with the eligible destination office', async () => {
  const result = await impact()
  expect(result.manual_assets.map((a: { id: string }) => a.id).sort()).toEqual(
    [move, retire].sort()
  )
  expect(result.destination_offices.map((o: { id: string }) => o.id)).toEqual([f.own.second])
})
for (const kind of ['missing', 'duplicate', 'foreign', 'extra'] as const)
  it(`rejects ${kind} decisions without touching any entity`, async () => {
    const body = input()
    if (kind === 'missing') body.manual_asset_decisions.pop()
    if (kind === 'duplicate') body.manual_asset_decisions[1] = body.manual_asset_decisions[0]
    if (kind === 'foreign') body.manual_asset_decisions[1].asset_id = f.foreign.office
    if (kind === 'extra')
      body.manual_asset_decisions.push({ asset_id: randomUUID(), destination: 'retire' })
    const before = await f.versions()
    const result = await save(body)
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('impact_changed')
    expect(await f.versions()).toEqual(before)
  })
for (const dest of ['same', 'foreign', 'inactive'] as const)
  it(`rejects ${dest} destination and leaves the office active`, async () => {
    const body = input()
    body.manual_asset_decisions[0].destination =
      dest === 'same' ? f.own.office : dest === 'foreign' ? f.foreign.office : inactive
    const before = await f.versions()
    const result = await save(body)
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('invalid_destination')
    expect(await f.versions()).toEqual(before)
  })
it('an actual asset created after preview invalidates confirmation before any cascade', async () => {
  await impact()
  const extra = await f.createManual()
  const before = await f.versions()
  const result = await save(input())
  expect(result.status).toBe(409)
  expect(result.data.error).toBe('impact_changed')
  expect(await f.versions()).toEqual(before)
  expect((await f.api(`/non-network-assets/${extra.id}`, f.own.adminCookie, 'DELETE')).status).toBe(
    200
  )
})
for (const change of ['moved', 'retired', 'deleted'] as const)
  it(`an asset ${change} after preview invalidates the old decision set`, async () => {
    const asset = await f.createManual(f.own, { asset_category: 'printer' })
    await impact()
    const body = input()
    body.manual_asset_decisions.push({ asset_id: asset.id, destination: 'retire' })
    const result =
      change === 'deleted'
        ? await f.api(`/non-network-assets/${asset.id}`, f.own.adminCookie, 'DELETE')
        : await f.api(
            `/non-network-assets/${asset.id}`,
            f.own.adminCookie,
            'PATCH',
            change === 'moved'
              ? { office: f.own.second, owner: f.own.outside }
              : { status: 'retired' }
          )
    expect(result.status).toBe(200)
    const before = await f.versions()
    const stale = await save(body)
    expect(stale.status).toBe(409)
    expect(stale.data.error).toBe('impact_changed')
    expect(await f.versions()).toEqual(before)
  })

for (const checkpoint of [
  'non-network-assets',
  'assets',
  'agents',
  'organization-memberships',
  'offices',
] as const)
  it(`failure AFTER writing ${checkpoint} rolls back the complete deactivation, including sessions`, async () => {
    await impact()
    const before = await f.versions(['inventory-incidents', 'risk-contributions'])
    const users = (
      await f.payload.find({
        collection: 'users',
        overrideAccess: true,
        depth: 0,
        pagination: false,
      })
    ).docs
    const original = f.payload.update.bind(f.payload)
    let written = false
    const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
      const result = (await original(args as never)) as never
      if (args.collection === checkpoint) {
        written = true
        expect(args.req?.transactionID).toBeTruthy()
        throw new Error(`Controlled failure after ${checkpoint} write`)
      }
      return result
    })
    let result
    try {
      result = await save(input())
    } finally {
      spy.mockRestore()
    }
    expect(written).toBe(true)
    expect(result.status).toBe(500)
    expect(await f.versions(['inventory-incidents', 'risk-contributions'])).toEqual(before)
    expect(
      (
        await f.payload.find({
          collection: 'users',
          overrideAccess: true,
          depth: 0,
          pagination: false,
        })
      ).docs
    ).toEqual(users)
    expect((await f.api('/v1/session', f.own.managerCookie)).status).toBe(200)
    expect((await f.api('/v1/session', f.own.viewerCookie)).status).toBe(200)
  })
it('retry commits the transfer, retirement, scanner revocation and account deactivation together', async () => {
  const result = await save(input())
  expect(result.status, JSON.stringify(result.data)).toBe(200)
  const moved = await f.payload.findByID({
    collection: 'non-network-assets',
    id: move,
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(moved.office)).toBe(f.own.second)
  expect(moved.owner).toBeFalsy()
  expect(moved.location).toBeFalsy()
  const retired = await f.payload.findByID({
    collection: 'non-network-assets',
    id: retire,
    overrideAccess: true,
    depth: 0,
  })
  expect(retired.status).toBe('retired')
  expect(retired.deleted_at).toBeFalsy()
  const assets = await f.payload.find({
    collection: 'assets',
    overrideAccess: true,
    where: { office: { equals: f.own.office } },
    depth: 0,
  })
  expect(assets.docs.length).toBeGreaterThan(0)
  expect(assets.docs.every(a => a.status === 'retired')).toBe(true)
  const agents = await f.payload.find({
    collection: 'agents',
    overrideAccess: true,
    where: { office: { equals: f.own.office } },
    depth: 0,
  })
  expect(agents.docs.every(a => Boolean(a.revoked_at))).toBe(true)
  expect((await f.api('/v1/session', f.own.managerCookie)).status).toBe(401)
  expect((await f.api('/v1/session', f.own.viewerCookie)).status).toBe(401)
  expect((await f.api('/v1/session', f.own.outsideCookie)).status).toBe(200)
})
it('reactivating the office restores no assets, scanner credentials or former sessions', async () => {
  expect((await save({ is_active: true })).status).toBe(200)
  expect(
    (
      await f.payload.findByID({
        collection: 'non-network-assets',
        id: move,
        overrideAccess: true,
        depth: 0,
      })
    ).office
  ).toBe(f.own.second)
  expect(
    (
      await f.payload.findByID({
        collection: 'non-network-assets',
        id: retire,
        overrideAccess: true,
      })
    ).status
  ).toBe('retired')
  const agents = await f.payload.find({
    collection: 'agents',
    overrideAccess: true,
    where: { office: { equals: f.own.office } },
  })
  expect(agents.docs.every(a => Boolean(a.revoked_at))).toBe(true)
  expect((await f.api('/v1/session', f.own.viewerCookie)).status).toBe(401)
  const before = await f.versions()
  expect((await save({ is_active: true })).status).toBe(200)
  expect(await f.versions()).toEqual(before)
})
