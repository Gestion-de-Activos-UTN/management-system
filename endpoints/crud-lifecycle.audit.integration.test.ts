import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'
import { member } from '@/domain/risk/risk-integration-seed'

let f: ScopeFixture
beforeAll(async () => {
  f = await scopeFixture('crud')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
const product = {
  software_vendor: 'Canonical',
  software_product: 'Ubuntu',
  software_version: '24.04',
}
const groups = [
  { category: 'software_license', field: 'product_details', value: product },
  {
    category: 'cloud_asset',
    field: 'cloud_details',
    value: { kind: 'infrastructure', vendor: 'Proveedor' },
  },
  { category: 'information_repository', field: 'repository_details', value: { kind: 'database' } },
] as const
const read = (id: string) =>
  f.payload.findByID({ collection: 'non-network-assets', id, overrideAccess: true, depth: 0 })
const patch = (id: string, body: unknown) =>
  f.api(`/non-network-assets/${id}`, f.own.adminCookie, 'PATCH', body)
async function reviews(id: string) {
  return (
    await f.payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { manual_asset: { equals: id } },
    })
  ).docs
}
function details(category: string) {
  const group = groups.find(
    g => g.category === category || (category === 'antivirus_edr' && g.field === 'product_details')
  )
  return group ? { [group.field]: group.value } : {}
}
for (const category of [
  'computer',
  'mobile_device',
  'server',
  'network_device',
  'printer',
  'iot',
  'removable_media',
  'other_equipment',
  'antivirus_edr',
  'software_license',
  'cloud_asset',
  'provider_service',
  'backup',
  'information_repository',
  'physical_record',
  'other',
]) {
  it(`${category}: creates and persists the real category contract and applicable review`, async () => {
    const doc = await f.createManual(f.own, { asset_category: category, ...details(category) })
    const saved = await read(doc.id)
    expect(saved).toMatchObject({ asset_category: category, ...details(category) })
    expect(relationId(saved.organization)).toBe(f.own.org)
    const open = (await reviews(doc.id)).filter(r => ['pending', 'in_progress'].includes(r.status))
    expect(open).toHaveLength(
      ['computer', 'software_license', 'cloud_asset', 'information_repository'].includes(category)
        ? 1
        : 0
    )
    if (['software_license', 'antivirus_edr'].includes(category))
      expect(saved.cpe_candidate).toBeTruthy()
  })
}
for (const from of groups)
  for (const to of [
    ...groups.filter(g => g.field !== from.field),
    { category: 'printer', field: null, value: null },
  ]) {
    it(`${from.category} -> ${to.category}: clears obsolete fields and preserves the new group`, async () => {
      const doc = await f.createManual(f.own, {
        asset_category: from.category,
        [from.field]: from.value,
      })
      const result = await patch(doc.id, {
        asset_category: to.category,
        ...(to.field ? { [to.field]: to.value } : {}),
      })
      expect(result.status, JSON.stringify(result.data)).toBe(200)
      const saved = await read(doc.id)
      expect(Object.values(saved[from.field] ?? {}).every(v => v == null)).toBe(true)
      if (to.field) expect(saved[to.field]).toMatchObject(to.value!)
      if (from.field === 'product_details') expect(saved.cpe_candidate).toBeFalsy()
      const all = await reviews(doc.id)
      expect(all.filter(r => r.status === 'superseded')).toHaveLength(1)
      expect(all.filter(r => ['pending', 'in_progress'].includes(r.status))).toHaveLength(
        to.field ? 1 : 0
      )
    })
  }
it('a partial product edit retains required identity and may clear the optional version', async () => {
  const doc = await f.createManual(f.own, {
    asset_category: 'software_license',
    product_details: product,
    review_interval: '1m',
  })
  expect(
    (await patch(doc.id, { product_details: { software_version: null }, notes: 'Edición parcial' }))
      .status
  ).toBe(200)
  const saved = await read(doc.id)
  expect(saved.product_details).toMatchObject({ ...product, software_version: null })
  expect(saved.next_review_at).toBe(doc.next_review_at)
})
for (const field of ['software_vendor', 'software_product'])
  it(`explicitly clearing ${field} rejects the entire update`, async () => {
    const doc = await f.createManual(f.own, {
      asset_category: 'software_license',
      product_details: product,
    })
    const before = await f.versions()
    expect((await patch(doc.id, { product_details: { [field]: null } })).status).toBe(400)
    expect(await f.versions()).toEqual(before)
  })
for (const owner of ['foreign', 'outside', 'null'] as const)
  it(`rejects ${owner} owner without partially updating the asset`, async () => {
    const doc = await f.createManual()
    const before = await f.versions()
    expect(
      (
        await patch(doc.id, {
          owner:
            owner === 'foreign' ? f.foreign.viewer : owner === 'outside' ? f.own.outside : null,
          notes: 'No guardar',
        })
      ).status
    ).toBe(400)
    expect(await f.versions()).toEqual(before)
  })
it('moving an asset requires an eligible destination owner and opens the review there', async () => {
  const doc = await f.createManual()
  const before = await f.versions()
  expect((await patch(doc.id, { office: f.own.second })).status).toBe(400)
  expect(await f.versions()).toEqual(before)
  expect((await patch(doc.id, { office: f.own.second, owner: f.own.outside })).status).toBe(200)
  const all = await reviews(doc.id)
  expect(all.filter(r => r.status === 'superseded')).toHaveLength(1)
  expect(all.filter(r => r.status === 'pending').map(r => relationId(r.office))).toEqual([
    f.own.second,
  ])
})
it('retirement closes the open review; revival opens exactly one new cycle', async () => {
  const doc = await f.createManual()
  expect((await patch(doc.id, { status: 'retired' })).status).toBe(200)
  expect((await reviews(doc.id)).map(r => r.status)).toEqual(['superseded'])
  expect((await patch(doc.id, { status: 'active' })).status).toBe(200)
  expect((await reviews(doc.id)).filter(r => r.status === 'pending')).toHaveLength(1)
})
it('logical deletion is repeatable and the historical asset cannot be revived', async () => {
  const doc = await f.createManual()
  expect((await f.api(`/non-network-assets/${doc.id}`, f.own.adminCookie, 'DELETE')).status).toBe(
    200
  )
  const before = await f.versions()
  expect((await f.api(`/non-network-assets/${doc.id}`, f.own.adminCookie, 'DELETE')).status).toBe(
    200
  )
  expect(await f.versions()).toEqual(before)
  expect((await patch(doc.id, { status: 'active' })).status).toBe(409)
  expect(await f.versions()).toEqual(before)
})
it('a failure AFTER child review creation rolls back the primary create and allows one clean retry', async () => {
  const body = f.manualInput(f.own)
  const before = await f.versions()
  const original = f.payload.create.bind(f.payload)
  let written = false
  const spy = vi.spyOn(f.payload, 'create').mockImplementation(async args => {
    const doc = await original(args as never)
    if (args.collection === 'assessment-instances') {
      written = true
      expect(args.req?.transactionID).toBeTruthy()
      throw new Error('Controlled failure after review write')
    }
    return doc
  })
  let result
  try {
    result = await f.api('/non-network-assets', f.own.adminCookie, 'POST', body)
  } finally {
    spy.mockRestore()
  }
  expect(written).toBe(true)
  expect(result.status).toBe(500)
  expect(await f.versions()).toEqual(before)
  const retry = await f.api('/non-network-assets', f.own.adminCookie, 'POST', body)
  expect(retry.status).toBe(201)
  expect(await reviews(retry.data.doc.id)).toHaveLength(1)
  expect(
    (
      await f.payload.count({
        collection: 'non-network-assets',
        overrideAccess: true,
        where: { alias: { equals: body.alias } },
      })
    ).totalDocs
  ).toBe(1)
})
it('a failure AFTER superseding a review rolls back category, history and queued recalculations', async () => {
  const doc = await f.createManual()
  const before = await f.versions()
  const original = f.payload.update.bind(f.payload)
  let written = false
  const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    const result = (await original(args as never)) as never
    if (
      args.collection === 'assessment-instances' &&
      (args.data as { status?: string }).status === 'superseded'
    ) {
      written = true
      expect(args.req?.transactionID).toBeTruthy()
      throw new Error('Controlled failure after review closure')
    }
    return result
  })
  let result
  try {
    result = await patch(doc.id, { asset_category: 'printer' })
  } finally {
    spy.mockRestore()
  }
  expect(written).toBe(true)
  expect(result.status).toBe(500)
  expect(await f.versions()).toEqual(before)
  expect((await patch(doc.id, { asset_category: 'printer' })).status).toBe(200)
  expect((await reviews(doc.id)).map(r => r.status)).toEqual(['superseded'])
})

async function taskScenario() {
  await f.payload.update({
    collection: 'subscriptions',
    overrideAccess: true,
    where: { organization: { equals: f.own.org } },
    data: {
      features: {
        asset_inventory: true,
        security_assessments: true,
        risk_score: true,
        tasks: true,
      },
    },
  })
  const asset = await f.createManual()
  const created = await f.api('/v1/tasks', f.own.adminCookie, 'POST', {
    title: 'Tarea vinculada a traslado',
    priority: 'normal',
    global: false,
    office_ids: [f.own.office],
    assignment_kind: 'open_pool',
    related_entity: { relationTo: 'non-network-assets', value: asset.id },
  })
  expect(created.status, JSON.stringify(created.data)).toBe(201)
  const id = String(created.data.docs[0].id)
  expect((await f.api(`/v1/tasks/${id}/claim`, f.own.viewerCookie, 'POST')).status).toBe(200)
  return { asset: asset.id as string, task: id }
}
it('moving a claimed asset task rehomes it and releases a claimant without destination access', async () => {
  const item = await taskScenario()
  expect((await patch(item.asset, { office: f.own.second, owner: f.own.outside })).status).toBe(200)
  const task = await f.payload.findByID({
    collection: 'tasks',
    id: item.task,
    overrideAccess: true,
    depth: 0,
  })
  expect(relationId(task.office)).toBe(f.own.second)
  expect(task.status).toBe('pending')
  expect(task.claimed_by).toBeFalsy()
  expect(Array.isArray(task.lifecycle_history) && task.lifecycle_history.length).toBeGreaterThan(0)
})
it('a failure AFTER moving the linked task rolls back asset, review and claim; retry succeeds', async () => {
  const item = await taskScenario()
  const before = await f.versions()
  const taskBefore = await f.payload.findByID({
    collection: 'tasks',
    id: item.task,
    overrideAccess: true,
    depth: 0,
  })
  const original = f.payload.update.bind(f.payload)
  let written = false
  const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    const result = (await original(args as never)) as never
    if (args.collection === 'tasks' && args.id === item.task) {
      written = true
      expect(args.req?.transactionID).toBeTruthy()
      throw new Error('Controlled failure after task movement')
    }
    return result
  })
  let result
  try {
    result = await patch(item.asset, { office: f.own.second, owner: f.own.outside })
  } finally {
    spy.mockRestore()
  }
  expect(written).toBe(true)
  expect(result.status).toBe(500)
  expect(await f.versions()).toEqual(before)
  expect(
    await f.payload.findByID({ collection: 'tasks', id: item.task, overrideAccess: true, depth: 0 })
  ).toEqual(taskBefore)
  expect((await patch(item.asset, { office: f.own.second, owner: f.own.outside })).status).toBe(200)
})
it('retirement cancels a claimed linked task and revival preserves its cancelled history', async () => {
  const item = await taskScenario()
  expect((await patch(item.asset, { status: 'retired' })).status).toBe(200)
  const cancelled = await f.payload.findByID({
    collection: 'tasks',
    id: item.task,
    overrideAccess: true,
    depth: 0,
  })
  expect(cancelled.status).toBe('cancelled')
  expect((await patch(item.asset, { status: 'active' })).status).toBe(200)
  expect(
    await f.payload.findByID({ collection: 'tasks', id: item.task, overrideAccess: true, depth: 0 })
  ).toEqual(cancelled)
})

it('a deactivated owner cannot be assigned again; the released asset remains editable without reactivation', async () => {
  const user = await member(f.payload, f.own.org, [f.own.office], 'org_viewer')
  const account = await f.payload.findByID({ collection: 'users', id: user, overrideAccess: true })
  const asset = await f.createManual(f.own, { owner: user })
  expect(
    (
      await f.api(`/v1/org-members/${user}`, f.own.adminCookie, 'PATCH', {
        is_active: false,
        confirm_email: account.email,
      })
    ).status
  ).toBe(200)
  expect((await read(asset.id)).owner).toBeFalsy()
  expect((await patch(asset.id, { notes: 'Conservar historial sin responsable' })).status).toBe(200)
  const before = await f.versions()
  expect((await patch(asset.id, { owner: user })).status).toBe(400)
  expect(await f.versions()).toEqual(before)
  expect((await patch(asset.id, { office: f.own.second })).status).toBe(400)
  expect(await f.versions()).toEqual(before)
  expect((await patch(asset.id, { office: f.own.second, owner: f.own.outside })).status).toBe(200)
})
