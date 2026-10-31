import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'
import { createLocalReq } from 'payload'

let f: ScopeFixture
beforeAll(async () => {
  f = await scopeFixture('manual')
}, 60000)
afterAll(async () => {
  if (f) await f.payload.destroy()
})
const path = (id: string) => `/non-network-assets/${id}`
async function dueManual() {
  const asset = await f.createManual(f.own, { review_interval: '1d' })
  const req = await createLocalReq(
    { user: { id: f.own.admin, collection: 'users' } as never },
    f.payload
  )
  await f.payload.update({
    collection: 'non-network-assets',
    id: asset.id,
    overrideAccess: true,
    req,
    context: { seedEffectiveNow: '2020-01-01T00:00:00.000Z', reviewConfirmed: true },
    data: { review_interval: '1d' },
  })
  return asset
}

for (const actor of ['admin', 'manager', 'viewer', 'platform', 'visited', 'anonymous'] as const) {
  const cookie = () =>
    actor === 'anonymous'
      ? ''
      : actor === 'platform' || actor === 'visited'
        ? f.platform
        : f.own[`${actor}Cookie`]
  const suffix = () => (actor === 'visited' ? `?asOrganization=${f.own.org}` : '')
  const allowed = ['admin', 'manager', 'visited'].includes(actor)
  it(`${actor}: create respects effective permissions`, async () => {
    const before = await f.versions()
    const result = await f.api(
      `/non-network-assets${suffix()}`,
      cookie(),
      'POST',
      f.manualInput(f.own)
    )
    expect(result.status).toBe(allowed ? 201 : 403)
    if (allowed) {
      const row = await f.payload.findByID({
        collection: 'non-network-assets',
        id: result.data.doc.id,
        overrideAccess: true,
        depth: 0,
      })
      expect(relationId(row.organization)).toBe(f.own.org)
      expect(relationId(row.office)).toBe(f.own.office)
    } else expect(await f.versions()).toEqual(before)
  })
  it(`${actor}: update respects effective permissions`, async () => {
    const asset = await f.createManual()
    const before = await f.versions()
    const result = await f.api(`${path(asset.id)}${suffix()}`, cookie(), 'PATCH', {
      alias: 'Nombre actualizado',
    })
    expect(result.status).toBe(allowed ? 200 : 403)
    if (allowed)
      expect(
        (
          await f.payload.findByID({
            collection: 'non-network-assets',
            id: asset.id,
            overrideAccess: true,
          })
        ).alias
      ).toBe('Nombre actualizado')
    else expect(await f.versions()).toEqual(before)
  })
  it(`${actor}: logical deletion preserves the permissions and historical row`, async () => {
    const asset = await f.createManual()
    const before = await f.versions()
    const result = await f.api(`${path(asset.id)}${suffix()}`, cookie(), 'DELETE')
    const mayDelete = actor === 'admin' || actor === 'visited'
    expect(result.status).toBe(mayDelete ? 200 : actor === 'anonymous' ? 401 : 403)
    if (mayDelete)
      expect(
        await f.payload.findByID({
          collection: 'non-network-assets',
          id: asset.id,
          overrideAccess: true,
        })
      ).toMatchObject({ status: 'retired', deleted_at: expect.any(String) })
    else expect(await f.versions()).toEqual(before)
  })
}

for (const actor of ['admin', 'manager', 'viewer'] as const) {
  it(`${actor}: foreign details cannot be read or updated`, async () => {
    const asset = await f.createManual(f.foreign)
    const before = await f.versions()
    expect((await f.api(path(asset.id), f.own[`${actor}Cookie`])).status).toBe(404)
    const result = await f.api(path(asset.id), f.own[`${actor}Cookie`], 'PATCH', {
      alias: 'Cambio ajeno',
    })
    // Payload's native update API returns 403 when its access filter excludes the row.
    expect(result.status).toBe(403)
    expect(await f.versions()).toEqual(before)
  })
}

it('an assigned office restricts reads, updates and destination offices independently', async () => {
  const asset = await f.createManual(f.own, { office: f.own.second, owner: f.own.outside })
  expect((await f.api(path(asset.id), f.own.adminCookie)).status).toBe(200)
  const before = await f.versions()
  expect((await f.api(path(asset.id), f.own.managerCookie)).status).toBe(404)
  expect(
    (await f.api(path(asset.id), f.own.managerCookie, 'PATCH', { alias: 'Fuera de oficina' }))
      .status
  ).toBe(403)
  expect(
    (
      await f.api(
        '/non-network-assets',
        f.own.managerCookie,
        'POST',
        f.manualInput(f.own, { office: f.own.second, owner: f.own.outside })
      )
    ).status
  ).toBe(403)
  expect(await f.versions()).toEqual(before)
})

for (const target of ['foreign-office', 'foreign-owner', 'other-office-owner'] as const) {
  it(`creation rejects ${target} without persisting partial assets or reviews`, async () => {
    const input = f.manualInput(
      f.own,
      target === 'foreign-office'
        ? { office: f.foreign.office, owner: f.foreign.viewer }
        : { owner: target === 'foreign-owner' ? f.foreign.viewer : f.own.outside }
    )
    const before = await f.versions()
    expect((await f.api('/non-network-assets', f.own.adminCookie, 'POST', input)).status).toBe(
      target === 'foreign-office' ? 403 : 400
    )
    expect(await f.versions()).toEqual(before)
  })
}

it('server-derived fields cannot be forged through public REST create or update', async () => {
  const create = await f.api(
    '/non-network-assets',
    f.own.adminCookie,
    'POST',
    f.manualInput(f.own, {
      organization: f.foreign.org,
      deleted_at: '2020-01-01T00:00:00.000Z',
      next_review_at: '2020-01-01T00:00:00.000Z',
      seed_key: 'forged',
    })
  )
  expect(create.status).toBe(201)
  const id = create.data.doc.id
  expect(
    (
      await f.api(path(id), f.own.adminCookie, 'PATCH', {
        organization: f.foreign.org,
        deleted_at: '2020-01-01T00:00:00.000Z',
      })
    ).status
  ).toBe(200)
  const row = await f.payload.findByID({
    collection: 'non-network-assets',
    id,
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(row.organization)).toBe(f.own.org)
  expect(row.deleted_at).toBeNull()
  expect(row.seed_key).toBeNull()
  expect(row.next_review_at).toBeNull()
})

it('old cookies lose manual-asset write access after membership deactivation', async () => {
  const asset = await f.createManual()
  const user = await f.payload.findByID({
    collection: 'users',
    id: f.own.manager,
    overrideAccess: true,
  })
  expect(
    (
      await f.api(`/v1/org-members/${user.id}`, f.own.adminCookie, 'PATCH', {
        is_active: false,
        confirm_email: user.email,
      })
    ).status
  ).toBe(200)
  const before = await f.versions()
  expect(
    (await f.api(path(asset.id), f.own.managerCookie, 'PATCH', { alias: 'Sesión revocada' })).status
  ).toBe(403)
  expect(await f.versions()).toEqual(before)
})

it('visiting an active organization can confirm a due manual-asset review', async () => {
  const asset = await dueManual()
  const result = await f.api(
    `/v1/non-network-assets/${asset.id}/review?asOrganization=${f.own.org}`,
    f.platform,
    'PATCH',
    {}
  )
  expect(result.status).toBe(200)
  const saved = await f.payload.findByID({
    collection: 'non-network-assets',
    id: asset.id,
    overrideAccess: true,
  })
  expect(saved.last_reviewed_at).toBeTruthy()
  expect(Date.parse(saved.next_review_at!)).toBeGreaterThan(Date.now())
})

let inactiveAssetId: string
describe('visiting an inactive organization', () => {
  let asset: { id: string }
  beforeAll(async () => {
    asset = await dueManual()
    inactiveAssetId = asset.id
    await f.deactivate()
  })
  for (const action of ['edit', 'review', 'delete'] as const) {
    it(`cannot ${action} a manual asset or change its persisted state`, async () => {
      const before = await f.versions()
      const suffix = `?asOrganization=${f.own.org}`
      expect((await f.api(`${path(asset.id)}${suffix}`, f.platform)).status).toBe(200)
      const route =
        action === 'review'
          ? `/v1/non-network-assets/${asset.id}/review${suffix}`
          : `${path(asset.id)}${suffix}`
      const result = await f.api(
        route,
        f.platform,
        action === 'delete' ? 'DELETE' : 'PATCH',
        action === 'delete'
          ? undefined
          : action === 'edit'
            ? { alias: 'No guardar en organización inactiva' }
            : {}
      )
      const after = await f.versions()
      const changed = Object.keys(before).filter(
        key => JSON.stringify(before[key]) !== JSON.stringify(after[key])
      )
      expect
        .soft([401, 403, 409], `${action}: status=${result.status}, changed=${changed.join(',')}`)
        .toContain(result.status)
      expect(changed, 'An inactive tenant must remain unchanged').toEqual([])
    })
  }
})

it('StaffPortal reactivation makes the visited manual asset editable again', async () => {
  expect(
    (
      await f.api(`/v1/platform-admin/organizations/${f.own.org}/status`, f.platform, 'POST', {
        is_active: true,
      })
    ).status
  ).toBe(200)
  const result = await f.api(
    `${path(inactiveAssetId)}?asOrganization=${f.own.org}`,
    f.platform,
    'PATCH',
    { alias: 'Edición tras reactivar' }
  )
  expect(result.status).toBe(200)
  expect(
    (
      await f.payload.findByID({
        collection: 'non-network-assets',
        id: inactiveAssetId,
        overrideAccess: true,
      })
    ).alias
  ).toBe('Edición tras reactivar')
})
