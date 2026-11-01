import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'

let f: ScopeFixture, manual: string
const endpoint = '/v1/inventory-snapshots/generate'
beforeAll(async () => {
  f = await scopeFixture('snapshots')
  manual = String((await f.createManual()).id)
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
const generate = (body: unknown, cookie = f.own.adminCookie, suffix = '') =>
  f.api(endpoint + suffix, cookie, 'POST', body)
const versions = () => f.versions(['risk-contributions', 'scan-reports'])
const stored = (id: string) =>
  f.payload.findByID({ collection: 'inventory-snapshots', id, overrideAccess: true, depth: 0 })
function cookie(actor: string) {
  return actor === 'anonymous'
    ? ''
    : actor === 'platform' || actor === 'visited'
      ? f.platform
      : actor === 'foreign'
        ? f.foreign.adminCookie
        : f.own[
            `${actor}Cookie` as 'adminCookie' | 'managerCookie' | 'viewerCookie' | 'outsideCookie'
          ]
}
for (const actor of [
  'admin',
  'manager',
  'viewer',
  'outside',
  'foreign',
  'platform',
  'visited',
  'anonymous',
])
  it(`${actor}: manual generation follows effective permissions, scope and author collection`, async () => {
    const before = await versions()
    const allowed = ['admin', 'visited'].includes(actor)
    const result = await generate(
      { office_id: f.own.office },
      cookie(actor),
      actor === 'visited' ? `?asOrganization=${f.own.org}` : ''
    )
    expect(result.status, String(result.data.error ?? 'unexpected_status')).toBe(
      allowed ? 201 : actor === 'anonymous' ? 401 : 403
    )
    if (!allowed) {
      expect(await versions()).toEqual(before)
      return
    }
    const doc = await stored(result.data.id)
    expect(doc.generated_by).toBe('manual')
    expect(relationId(doc.office)).toBe(f.own.office)
    expect(relationId(doc.organization)).toBe(f.own.org)
    const platform = actor === 'platform' || actor === 'visited'
    expect(doc.triggered_by_user?.relationTo).toBe(platform ? 'admins' : 'users')
    const session = await f.api('/v1/session', cookie(actor))
    expect(relationId(doc.triggered_by_user)).toBe(session.data.userId)
    expect(typeof result.data.risk_score).toBe('string')
  })
for (const body of [undefined, {}, null, { office_id: null }, { office_id: '' }])
  it(`missing office ${JSON.stringify(body)} returns 400 without writes`, async () => {
    const before = await versions()
    expect((await generate(body)).status).toBe(400)
    expect(await versions()).toEqual(before)
  })
for (const office of ['foreign', 'unassigned'] as const)
  it(`${office} office cannot receive a snapshot under another organization context`, async () => {
    const before = await versions()
    const id = office === 'foreign' ? f.foreign.office : randomUUID()
    expect((await generate({ office_id: id })).status).toBe(403)
    expect(await versions()).toEqual(before)
  })
it('extra body fields cannot spoof organization, origin, author, asset dump or risk reference', async () => {
  const result = await generate({
    office_id: f.own.office,
    organization: f.foreign.org,
    generated_by: 'scheduled',
    triggered_by_user: { relationTo: 'users', value: f.foreign.admin },
    assets_dump: { network: [], non_network: [] },
    risk_score: randomUUID(),
    display_name: 'No aceptar',
  })
  expect(result.status).toBe(201)
  const doc = await stored(result.data.id)
  expect(doc.generated_by).toBe('manual')
  expect(relationId(doc.organization)).toBe(f.own.org)
  expect(relationId(doc.triggered_by_user)).toBe(f.own.admin)
  expect(doc.display_name).toBeFalsy()
  const dump = doc.assets_dump as {
    network: Array<{ office: string }>
    non_network: Array<{ id: string }>
  }
  expect(dump.network.length).toBeGreaterThan(0)
  expect(dump.network.every(a => a.office === f.own.office)).toBe(true)
  expect(dump.non_network.map(a => a.id)).toContain(manual)
})
it('each explicit generation freezes a newly calculated office evaluation instead of reusing the latest', async () => {
  const first = await generate({ office_id: f.own.office })
  expect(first.status).toBe(201)
  const old = await stored(first.data.id)
  const second = await generate({ office_id: f.own.office })
  expect(second.status).toBe(201)
  expect(second.data.id).not.toBe(first.data.id)
  expect(relationId(second.data.risk_score)).not.toBe(relationId(old.risk_score))
  const evaluation = await f.payload.findByID({
    collection: 'risk-evaluations',
    id: relationId(second.data.risk_score),
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(evaluation.office)).toBe(f.own.office)
  expect(relationId(evaluation.organization)).toBe(f.own.org)
  const summary = second.data.assessment_results_snapshot
  expect(summary).toMatchObject({
    evaluation_id: evaluation.id,
    coverage: evaluation.coverage,
    evaluated_at: evaluation.evaluated_at,
    unknown_percentage: evaluation.unknown_percentage,
  })
  expect(await stored(first.data.id)).toEqual(old)
})
it('an empty active office gets a coherent empty inventory rather than assets from another office', async () => {
  const result = await generate({ office_id: f.own.second })
  expect(result.status).toBe(201)
  expect(result.data.assets_dump).toEqual({ network: [], non_network: [] })
  expect(result.data.assessment_results_snapshot.score).toBeNull()
})
it('later edits, transfer and logical deletion do not rewrite the original inventory or risk history', async () => {
  const asset = await f.createManual(f.own, { alias: 'Valor histórico original' })
  const snapshot = await generate({ office_id: f.own.office })
  expect(snapshot.status).toBe(201)
  const original = await stored(snapshot.data.id)
  const risk = await f.payload.findByID({
    collection: 'risk-evaluations',
    id: relationId(original.risk_score),
    overrideAccess: true,
    depth: 0,
  })
  expect(
    (
      await f.api(`/non-network-assets/${asset.id}`, f.own.adminCookie, 'PATCH', {
        alias: 'Valor posterior',
        office: f.own.second,
        owner: f.own.outside,
      })
    ).status
  ).toBe(200)
  expect((await f.api(`/non-network-assets/${asset.id}`, f.own.adminCookie, 'DELETE')).status).toBe(
    200
  )
  const later = await generate({ office_id: f.own.office })
  expect(later.status).toBe(201)
  expect(
    (later.data.assets_dump.non_network as Array<{ id: string }>).map(a => a.id)
  ).not.toContain(asset.id)
  expect(await stored(snapshot.data.id)).toEqual(original)
  expect(
    await f.payload.findByID({
      collection: 'risk-evaluations',
      id: risk.id,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(risk)
  expect(
    (
      original.assets_dump as { non_network: Array<{ id: string; alias: string }> }
    ).non_network.find(a => a.id === asset.id)?.alias
  ).toBe('Valor histórico original')
})
for (const checkpoint of ['risk-evaluations', 'risk-contributions', 'inventory-snapshots'] as const)
  it(`failure AFTER ${checkpoint} persistence leaves no partial snapshot, evaluation or contributions and permits retry`, async () => {
    const before = await versions()
    const original = f.payload.create.bind(f.payload)
    let written = false
    const spy = vi.spyOn(f.payload, 'create').mockImplementation(async args => {
      const doc = await original(args as never)
      if (args.collection === checkpoint) {
        written = true
        expect(args.req?.transactionID).toBeTruthy()
        throw new Error(`Controlled failure after ${checkpoint}`)
      }
      return doc
    })
    let result
    try {
      result = await generate({ office_id: f.own.office })
    } finally {
      spy.mockRestore()
    }
    expect(written).toBe(true)
    expect(result.status).toBe(500)
    expect(await versions()).toEqual(before)
    const retry = await generate({ office_id: f.own.office })
    expect(retry.status).toBe(201)
    const after = await versions()
    expect(after['inventory-snapshots'].length).toBe(before['inventory-snapshots'].length + 1)
    expect(after['risk-evaluations'].length).toBe(before['risk-evaluations'].length + 1)
  })
for (const method of ['POST', 'PATCH', 'DELETE'])
  it(`native REST ${method} cannot bypass immutable snapshot storage`, async () => {
    const snapshot = await generate({ office_id: f.own.office })
    expect(snapshot.status).toBe(201)
    const before = await versions()
    const result = await f.api(
      '/inventory-snapshots' + (method === 'POST' ? '' : `/${snapshot.data.id}`),
      f.own.adminCookie,
      method,
      method === 'DELETE'
        ? undefined
        : { assets_dump: { network: [], non_network: [] }, display_name: 'No guardar' }
    )
    expect(result.status).toBe(403)
    expect(await versions()).toEqual(before)
  })
describe('inactive offices and organizations', () => {
  beforeAll(async () => {
    await f.payload.update({
      collection: 'offices',
      id: f.own.second,
      overrideAccess: true,
      data: { is_active: false },
    })
  })
  it('rejects an inactive destination before calculating or saving risk', async () => {
    const before = await versions()
    const result = await generate({ office_id: f.own.second })
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('office_inactive')
    expect(await versions()).toEqual(before)
  })
  it('an inactive organization visit cannot create snapshots, while stored history remains readable', async () => {
    const snapshot = await generate({ office_id: f.own.office })
    expect(snapshot.status).toBe(201)
    await f.deactivate()
    const before = await versions()
    const result = await generate(
      { office_id: f.own.office },
      f.platform,
      `?asOrganization=${f.own.org}`
    )
    expect(result.status).toBe(409)
    expect(await versions()).toEqual(before)
    expect(
      (
        await f.api(
          `/inventory-snapshots/${snapshot.data.id}?asOrganization=${f.own.org}&depth=0`,
          f.platform
        )
      ).status
    ).toBe(200)
    expect((await f.api('/v1/session', f.own.adminCookie)).status).toBe(401)
  })
})
