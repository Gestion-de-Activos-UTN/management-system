import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { fetchOfflineAfterHours } from '@/domain/inventories/agingSweep'
import { maybeCreateAutoSnapshot } from '@/domain/inventories/autoSnapshot'

let f: ScopeFixture
const endpoint = '/v1/organization-settings'
const defaults = {
  offline_after_hours: null,
  snapshot_before_each_scan: false,
  snapshot_interval_days: null,
}
const maturity = { maturity_it_owner: 'yes', maturity_security_budget: 'recurring' }
beforeAll(async () => {
  f = await scopeFixture('settings')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
async function stored(org = f.own.org) {
  return (
    await f.payload.find({
      collection: 'organization-settings',
      overrideAccess: true,
      where: { organization: { equals: org } },
      depth: 0,
      limit: 1,
    })
  ).docs[0]
}
const save = (body: unknown, cookie = f.own.adminCookie, suffix = '') =>
  f.api(endpoint + suffix, cookie, 'PATCH', body)

it('new settings expose unset overrides and the effective 72-hour platform default', async () => {
  const result = await f.api(endpoint, f.own.adminCookie)
  expect(result.status).toBe(200)
  expect(result.data).toMatchObject(defaults)
  expect(await fetchOfflineAfterHours(f.payload, f.own.org)).toBe(72)
})

for (const actor of ['admin', 'manager', 'viewer', 'platform', 'visited', 'anonymous'] as const) {
  const cookie = () =>
    actor === 'anonymous'
      ? ''
      : actor === 'platform' || actor === 'visited'
        ? f.platform
        : f.own[`${actor}Cookie`]
  const suffix = () => (actor === 'visited' ? `?asOrganization=${f.own.org}` : '')
  const allowed = actor === 'admin' || actor === 'visited'
  for (const action of ['read', 'inventory', 'maturity'] as const) {
    it(`${actor}: ${action} settings follow the effective organization permissions`, async () => {
      const before = await f.versions(),
        foreign = await stored(f.foreign.org)
      const result = await f.api(
        endpoint + (action === 'maturity' ? '/maturity' : '') + suffix(),
        cookie(),
        action === 'read' ? 'GET' : 'PATCH',
        action === 'read' ? undefined : action === 'inventory' ? defaults : maturity
      )
      expect(result.status).toBe(allowed ? 200 : actor === 'anonymous' ? 401 : 403)
      if (!allowed || action === 'read') expect(await f.versions()).toEqual(before)
      if (allowed) expect(result.data.organization).toBe(f.own.org)
      expect(await stored(f.foreign.org)).toEqual(foreign)
    })
  }
}

for (const hours of [24, 48, 72, 96, 168]) {
  it(`persists the supported ${hours}-hour inactivity threshold and uses it in inventory`, async () => {
    const result = await save({ ...defaults, offline_after_hours: hours })
    expect(result.status).toBe(200)
    expect((await stored()).offline_after_hours).toBe(hours)
    expect(await fetchOfflineAfterHours(f.payload, f.own.org)).toBe(hours)
    expect((await f.api(endpoint, f.own.adminCookie)).data.offline_after_hours).toBe(hours)
  })
}
for (const days of [1, 3, 7, 14, 30]) {
  it(`persists the supported ${days}-day snapshot interval`, async () => {
    expect((await save({ ...defaults, snapshot_interval_days: days })).status).toBe(200)
    expect((await stored()).snapshot_interval_days).toBe(days)
    expect((await f.api(endpoint, f.own.adminCookie)).data.snapshot_interval_days).toBe(days)
  })
}

for (const [field, values] of [
  ['offline_after_hours', [0, -1, 25, 72.5, '72']],
  ['snapshot_interval_days', [0, -1, 2, 7.5, '7']],
  ['snapshot_before_each_scan', [null, 'true', 1]],
] as const) {
  for (const value of values)
    it(`rejects ${field}=${JSON.stringify(value)} at the right field without writing`, async () => {
      const before = await f.versions()
      const result = await save({ ...defaults, [field]: value })
      expect(result.status).toBe(400)
      expect(result.data.error).toBe('invalid_settings')
      expect(result.data.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [field] })])
      )
      expect(await f.versions()).toEqual(before)
    })
}

it('missing overrides are invalid; explicit null means use platform defaults', async () => {
  const before = await f.versions()
  const result = await save({ snapshot_before_each_scan: false })
  expect(result.status).toBe(400)
  expect(result.data.issues.map((issue: { path: string[] }) => issue.path)).toEqual(
    expect.arrayContaining([['offline_after_hours'], ['snapshot_interval_days']])
  )
  expect(await f.versions()).toEqual(before)
  expect((await save(defaults)).status).toBe(200)
  expect(await stored()).toMatchObject(defaults)
})

it('extra fields cannot change tenant, policy, industry or maturity through inventory settings', async () => {
  const own = await stored(),
    foreign = await stored(f.foreign.org)
  const result = await save({
    ...defaults,
    organization: f.foreign.org,
    id: foreign.id,
    industry: 'Intento de cambio',
    assessment_policy_key: 'reinforced',
    assessment_policy_version: 999,
    maturity_it_owner: 'no',
    maturity_updated_by: f.foreign.admin,
    features: { tasks: false },
  })
  expect(result.status).toBe(200)
  const row = await stored()
  for (const key of [
    'id',
    'organization',
    'industry',
    'assessment_policy_key',
    'assessment_policy_version',
    'maturity_it_owner',
    'maturity_updated_by',
  ] as const)
    expect(row[key]).toEqual(own[key])
  expect(row).toMatchObject(defaults)
  expect(await stored(f.foreign.org)).toEqual(foreign)
})

it('a member cannot target another tenant by supplying asOrganization', async () => {
  const foreign = await stored(f.foreign.org)
  const result = await save(
    { ...defaults, offline_after_hours: 48 },
    f.own.adminCookie,
    `?asOrganization=${f.foreign.org}`
  )
  expect(result.status).toBe(200)
  expect(result.data.organization).toBe(f.own.org)
  expect((await stored()).offline_after_hours).toBe(48)
  expect(await stored(f.foreign.org)).toEqual(foreign)
})

it('snapshot-on-every-scan overrides the interval; restoring defaults disables it and uses seven days', async () => {
  const snapshots = () =>
    f.payload.find({
      collection: 'inventory-snapshots',
      overrideAccess: true,
      where: { office: { equals: f.own.office } },
      pagination: false,
      depth: 0,
    })
  expect(
    (
      await save({
        offline_after_hours: 24,
        snapshot_before_each_scan: true,
        snapshot_interval_days: 30,
      })
    ).status
  ).toBe(200)
  const before = (await snapshots()).totalDocs
  await maybeCreateAutoSnapshot(f.payload, f.own.office, f.own.org)
  await maybeCreateAutoSnapshot(f.payload, f.own.office, f.own.org)
  expect((await snapshots()).totalDocs).toBe(before + 2)
  expect((await save(defaults)).status).toBe(200)
  expect((await f.api(endpoint, f.own.adminCookie)).data).toMatchObject(defaults)
  expect(await fetchOfflineAfterHours(f.payload, f.own.org)).toBe(72)
  const rows = await snapshots()
  // Backdate only fixture snapshots in this disposable DB; never change the server clock.
  for (const [index, row] of rows.docs.entries())
    await f.payload.update({
      collection: 'inventory-snapshots',
      id: row.id,
      overrideAccess: true,
      data: { taken_at: new Date(Date.now() - 6 * 86400000 - index * 1000).toISOString() },
    })
  await maybeCreateAutoSnapshot(f.payload, f.own.office, f.own.org)
  expect((await snapshots()).totalDocs).toBe(before + 2)
  for (const [index, row] of rows.docs.entries())
    await f.payload.update({
      collection: 'inventory-snapshots',
      id: row.id,
      overrideAccess: true,
      data: { taken_at: new Date(Date.now() - 8 * 86400000 - index * 1000).toISOString() },
    })
  await maybeCreateAutoSnapshot(f.payload, f.own.office, f.own.org)
  expect((await snapshots()).totalDocs).toBe(before + 3)
})

for (const owner of ['yes', 'no'])
  for (const budget of ['none', 'occasional', 'recurring']) {
    it(`maturity ${owner}/${budget} records the real author without recalculating risk`, async () => {
      const before = await f.versions()
      expect(before['risk-evaluations'].length).toBeGreaterThan(0)
      const result = await f.api(endpoint + '/maturity', f.own.adminCookie, 'PATCH', {
        maturity_it_owner: owner,
        maturity_security_budget: budget,
        maturity_updated_by: f.foreign.viewer,
        maturity_updated_at: '2020-01-01T00:00:00.000Z',
      })
      expect(result.status).toBe(200)
      const row = await stored()
      expect(row).toMatchObject({
        maturity_it_owner: owner,
        maturity_security_budget: budget,
        maturity_updated_by: { relationTo: 'users', value: f.own.admin },
      })
      expect(Date.parse(row.maturity_updated_at!)).toBeGreaterThan(
        Date.parse('2020-01-01T00:00:00.000Z')
      )
      const after = await f.versions()
      for (const key of ['risk-evaluations', 'compliance-results', 'payload-jobs'])
        expect(after[key]).toEqual(before[key])
    })
  }

it('a visited maturity profile records a platform identity instead of impersonating an organization member', async () => {
  const session = await f.api('/v1/session', f.platform)
  const result = await f.api(
    `${endpoint}/maturity?asOrganization=${f.own.org}`,
    f.platform,
    'PATCH',
    maturity
  )
  expect(result.status).toBe(200)
  expect((await stored()).maturity_updated_by).toEqual({
    relationTo: 'admins',
    value: session.data.userId,
  })
})

for (const body of [
  {},
  { maturity_it_owner: 'yes' },
  { maturity_it_owner: 'maybe', maturity_security_budget: 'none' },
  { maturity_it_owner: 'no', maturity_security_budget: 'unlimited' },
]) {
  it(`invalid maturity ${JSON.stringify(body)} leaves settings intact`, async () => {
    const before = await f.versions()
    const result = await f.api(endpoint + '/maturity', f.own.adminCookie, 'PATCH', body)
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('invalid_maturity')
    expect(await f.versions()).toEqual(before)
  })
}

it('a controlled settings storage failure leaves data unchanged and permits retry', async () => {
  const before = await f.versions(),
    update = f.payload.update.bind(f.payload)
  const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
    if (args.collection === 'organization-settings')
      throw new Error('Controlled settings write failure')
    return update(args)
  })
  try {
    expect((await save(defaults)).status).toBe(500)
  } finally {
    spy.mockRestore()
  }
  expect(await f.versions()).toEqual(before)
  expect((await save(defaults)).status).toBe(200)
})

it('direct settings collection REST stays closed even to platform administrators', async () => {
  const row = await stored(),
    before = await f.versions()
  for (const cookie of [f.platform, f.own.adminCookie])
    for (const [path, method, body] of [
      ['/organization-settings', 'GET', undefined],
      ['/organization-settings', 'POST', { organization: f.own.org }],
      [`/organization-settings/${row.id}`, 'PATCH', { offline_after_hours: 24 }],
    ] as const)
      expect((await f.api(path, cookie, method, body)).status).toBe(403)
  expect(await f.versions()).toEqual(before)
})

it('deactivation preserves visited reads, rejects settings writes and revokes the old member cookie', async () => {
  await f.deactivate()
  const before = await f.versions(),
    suffix = `?asOrganization=${f.own.org}`
  expect((await f.api(endpoint + suffix, f.platform)).status).toBe(200)
  expect((await save(defaults, f.platform, suffix)).status).toBe(409)
  expect((await f.api(endpoint + '/maturity' + suffix, f.platform, 'PATCH', maturity)).status).toBe(
    409
  )
  expect((await f.api(endpoint, f.own.adminCookie)).status).toBe(401)
  expect(await f.versions()).toEqual(before)
})
