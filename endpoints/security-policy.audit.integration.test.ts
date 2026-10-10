import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { seedDemoData } from '@/domain/demo/seedDemoData'
import { loginBudget, loginOrigins } from '@/access/auth/login-throttle'
import { expireRawScanPayloads } from '@/domain/inventories/expireRawScanPayloads'

let payload: Payload, config: SanitizedConfig
const password = 'Password2026'
const collections = [
  'organizations',
  'offices',
  'users',
  'admins',
  'organization-memberships',
  'agents',
  'scan-reports',
  'assets',
  'non-network-assets',
  'assessment-instances',
  'assessment-answers',
  'tasks',
  'inventory-snapshots',
  'risk-evaluations',
] as const
async function api(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const response = await handleEndpoints({
    config,
    request: new Request('http://localhost' + path, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  })
  return { response, status: response.status, data: await response.json() }
}
async function login(email: string, collection = 'users') {
  const result = await api(`/api/${collection}/login`, 'POST', { email, password })
  expect(result.status).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}
async function findUser(email: string) {
  return (
    await payload.find({
      collection: 'users',
      overrideAccess: true,
      where: { email: { equals: email } },
    })
  ).docs[0]
}
async function counts() {
  return Object.fromEntries(
    await Promise.all(
      collections.map(async collection => [
        collection,
        (await payload.count({ collection, overrideAccess: true })).totalDocs,
      ])
    )
  )
}
beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_audit_security(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Requires the disposable security database')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  process.env.PAYLOAD_SECRET = 'siam-disposable-fix-regressions-secret'
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  loginBudget.clear()
  loginOrigins.clear()
})
afterAll(async () => {
  loginBudget.clear()
  loginOrigins.clear()
  if (payload) await payload.destroy()
})

it('seed: navigation and demo populate an empty database and repeat without overwriting edits', async () => {
  const { seedNavigation } = await import('@/scripts/seed-navigation')
  expect(
    (await payload.count({ collection: 'organizations', overrideAccess: true })).totalDocs
  ).toBe(0)
  await seedNavigation(payload)
  const first = await seedDemoData(payload)
  expect(first.tasksCreated).toBeGreaterThan(0)
  expect(first.reportsProcessed).toBeGreaterThan(0)
  const asset = (
    await payload.find({
      collection: 'assets',
      overrideAccess: true,
      where: { identified: { equals: true } },
      limit: 1,
    })
  ).docs[0]
  await payload.update({
    collection: 'assets',
    id: asset.id,
    overrideAccess: true,
    data: { alias: 'User changed alias' },
  })
  const before = await counts()
  await seedNavigation(payload)
  const second = await seedDemoData(payload)
  expect(second.tasksCreated).toBe(0)
  expect(second.reportsProcessed).toBe(0)
  const after = await counts()
  for (const key of Object.keys(before) as Array<keyof typeof before>) expect(after[key], String(key)).toBe(before[key])
  expect(
    (await payload.findByID({ collection: 'assets', id: asset.id, overrideAccess: true })).alias
  ).toBe('User changed alias')
  const tasks = await payload.find({ collection: 'tasks', overrideAccess: true, pagination: false })
  for (const task of tasks.docs)
    if (task.due_at) expect(Date.parse(task.start_at)).toBeLessThanOrEqual(Date.parse(task.due_at))
}, 120000)

it('technical permission: viewer sees report summary and normalized inventory, not nested evidence', async () => {
  const admin = await login('org-admin@siam.com'),
    viewer = await login('org-viewer@siam.com'),
    manager = await login('main-manager@siam.com')
  const reports = await api('/api/scan-reports?depth=0', 'GET', undefined, viewer)
  expect(reports.status).toBe(200)
  expect(reports.data.docs.length).toBeGreaterThan(0)
  for (const report of reports.data.docs) {
    expect(report.raw_payload).toBeUndefined()
    expect(report.error).toBeUndefined()
  }
  for (const cookie of [admin, manager]) {
    const response = await api('/api/scan-reports?depth=0', 'GET', undefined, cookie)
    expect(
      response.data.docs.some((report: { raw_payload?: unknown }) => Boolean(report.raw_payload))
    ).toBe(true)
  }
  const assets = await api('/api/assets?depth=0&limit=100', 'GET', undefined, viewer)
  expect(assets.data.docs.length).toBeGreaterThan(0)
  for (const asset of assets.data.docs) {
    expect(asset.host_scripts).toBeUndefined()
    for (const service of asset.services ?? []) expect(service.scripts).toBeUndefined()
  }
  const snapshots = await api(
    '/api/inventory-snapshots?depth=0&limit=100',
    'GET',
    undefined,
    viewer
  )
  expect(snapshots.data.docs.length).toBeGreaterThan(0)
  for (const snapshot of snapshots.data.docs)
    expect(JSON.stringify(snapshot.assets_dump)).not.toMatch(/"(?:host_scripts|scripts)":/)
  const session = await api('/api/v1/session', 'GET', undefined, viewer)
  expect(session.data.permissions.technicalEvidence).toBe(false)
  expect(
    (await api('/api/v1/session', 'GET', undefined, manager)).data.permissions.technicalEvidence
  ).toBe(true)
})

it('technical permission: OfficeManager cannot read another office through ID or relationship population', async () => {
  const manager = await login('main-manager@siam.com'),
    other = await login('secondary-manager@siam.com')
  const reports = await api('/api/scan-reports?depth=0', 'GET', undefined, other)
  expect(reports.data.docs.length).toBeGreaterThan(0)
  const report = await api(
    `/api/scan-reports/${reports.data.docs[0].id}?depth=2`,
    'GET',
    undefined,
    manager
  )
  expect([403, 404]).toContain(report.status)
})

it('retention: raw reports expire at 30 days, document summaries survive, job is repeatable', async () => {
  const report = (
    await payload.find({ collection: 'scan-reports', overrideAccess: true, limit: 1 })
  ).docs[0]
  const ttl = Date.parse(report.raw_payload_expires_at!) - Date.parse(report.createdAt)
  expect(Math.abs(ttl - 30 * 86400000)).toBeLessThan(10000)
  const assetsBefore = await payload.find({
    collection: 'assets',
    overrideAccess: true,
    pagination: false,
    depth: 0,
  })
  const snapshotsBefore = await payload.find({
    collection: 'inventory-snapshots',
    overrideAccess: true,
    pagination: false,
    depth: 0,
  })
  const normalized = await import('@/domain/inventories/technical-evidence')
  const result = await expireRawScanPayloads(payload, new Date(Date.now() + 31 * 86400000))
  expect(result.asset_evidence_expired).toBeGreaterThan(0)
  expect(result.snapshot_evidence_expired).toBeGreaterThan(0)
  const assetsAfter = await payload.find({
    collection: 'assets',
    overrideAccess: true,
    pagination: false,
    depth: 0,
  })
  for (const asset of assetsAfter.docs) {
    expect(asset.host_scripts).toBeNull()
    for (const service of asset.services ?? []) expect(service.scripts ?? null).toBeNull()
    const before = assetsBefore.docs.find(row => row.id === asset.id)!
    expect(asset.last_seen).toBe(before.last_seen)
    expect(asset.alias).toBe(before.alias)
    expect(asset.hostname).toBe(before.hostname)
    expect(normalized.redactTechnicalEvidence(asset.services)).toEqual(
      normalized.redactTechnicalEvidence(before.services)
    )
  }
  for (const before of snapshotsBefore.docs) {
    const after = await payload.findByID({
      collection: 'inventory-snapshots',
      id: before.id,
      overrideAccess: true,
      depth: 0,
    })
    expect(after.assets_dump).toEqual(normalized.redactTechnicalEvidence(before.assets_dump))
    expect(after.assessment_results_snapshot).toEqual(before.assessment_results_snapshot)
    expect(after.risk_score).toEqual(before.risk_score)
    expect(after.taken_at).toEqual(before.taken_at)
  }
  expect(
    (await payload.findByID({ collection: 'scan-reports', id: report.id, overrideAccess: true }))
      .raw_payload
  ).toBeNull()
  expect(await expireRawScanPayloads(payload, new Date(Date.now() + 31 * 86400000))).toEqual({
    expired: 0,
    asset_evidence_expired: 0,
    snapshot_evidence_expired: 0,
  })
})

it('SEC-41: process budget returns 429 without locking an account; a cleared budget allows login', async () => {
  const email = `throttle-${crypto.randomUUID()}@example.test`
  await payload.create({ collection: 'users', overrideAccess: true, data: { email, password, name: 'Throttle fixture', status: 'active' } })
  loginBudget.clear()
  loginOrigins.clear()
  // Exhaust the real bucket at a fixed bucket clock, independent of bcrypt/CPU load.
  const clock = Date.now()
  const realTake = loginBudget.take.bind(loginBudget)
  const take = vi.spyOn(loginBudget, 'take').mockImplementation(key => realTake(key, clock))
  try {
    for (let i = 0; i < 120; i++) expect(loginBudget.take('all')).toBe(true)
    const result = await api('/api/users/login', 'POST', { email, password: 'incorrect' })
    expect(result.status).toBe(429)
    expect(result.response.headers.get('retry-after')).toBe('1')
  } finally { take.mockRestore() }
  loginBudget.clear()
  await login(email)
})

it('SEC-42: deactivation revokes every cookie, rejects refresh/login and reactivation needs a new login', async () => {
  const user = await findUser('org-viewer@siam.com')
  const cookies = [await login(user.email), await login(user.email)]
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    data: { status: 'inactive' },
  })
  const current = await payload.db.findOne<{ id: string; sessions?: unknown[] }>({
    collection: 'users',
    where: { id: { equals: user.id } },
  })
  expect(current?.sessions ?? []).toEqual([])
  for (const cookie of cookies) {
    expect((await api('/api/users/refresh-token', 'POST', undefined, cookie)).status).toBe(403)
    expect((await api('/api/v1/session', 'GET', undefined, cookie)).status).toBe(401)
  }
  expect((await api('/api/users/login', 'POST', { email: user.email, password })).status).toBe(403)
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    data: { status: 'active' },
  })
  for (const cookie of cookies)
    expect((await api('/api/v1/session', 'GET', undefined, cookie)).status).toBe(401)
  await login(user.email)
})

it('SEC-42: concurrent successful logins preserve both sessions until deactivation', async () => {
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      name: 'Concurrent login',
      email: `concurrent-${crypto.randomUUID()}@example.test`,
      password,
      status: 'active',
    },
  })
  const cookies = await Promise.all([login(user.email), login(user.email)])
  const current = await payload.db.findOne<{ id: string; sessions?: unknown[] }>({
    collection: 'users',
    where: { id: { equals: user.id } },
  })
  expect(current?.sessions).toHaveLength(2)
  for (const cookie of cookies)
    expect((await api('/api/users/refresh-token', 'POST', undefined, cookie)).status).toBe(200)
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    data: { status: 'inactive' },
  })
  for (const cookie of cookies)
    expect((await api('/api/users/refresh-token', 'POST', undefined, cookie)).status).toBe(403)
})

async function waitForRowWaiter() {
  const db = payload.db as unknown as PostgresAdapter
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await db.drizzle.execute(
      sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`
    )
    if (result.rows.length) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Concurrent account operation did not wait for the row lock')
}

it('retention: cleanup waiting for an asset update preserves newly observed raw evidence', async () => {
  const asset = (
    await payload.find({
      collection: 'assets',
      overrideAccess: true,
      limit: 1,
      where: { identified: { equals: true } },
    })
  ).docs[0]
  await payload.update({
    collection: 'assets',
    id: asset.id,
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      last_seen: new Date(Date.now() - 31 * 86400000).toISOString(),
      host_scripts: { old: 'expired' },
    },
  })
  const req = await createLocalReq({ context: { systemJob: true } }, payload)
  const transactionID = await payload.db.beginTransaction()
  if (!transactionID) throw new Error('Requires transactions')
  req.transactionID = transactionID
  let pending: ReturnType<typeof expireRawScanPayloads> | undefined
  const freshTime = new Date().toISOString()
  try {
    await payload.update({
      collection: 'assets',
      id: asset.id,
      overrideAccess: true,
      req,
      data: { last_seen: freshTime, host_scripts: { fresh: 'must survive' } },
    })
    pending = expireRawScanPayloads(payload)
    await waitForRowWaiter()
    await payload.db.commitTransaction(transactionID)
    await pending
    const current = await payload.findByID({
      collection: 'assets',
      id: asset.id,
      overrideAccess: true,
    })
    expect(current.last_seen).toBe(freshTime)
    expect(current.host_scripts).toEqual({ fresh: 'must survive' })
  } finally {
    await payload.db.rollbackTransaction(transactionID)
    if (pending) await pending
    await payload.update({
      collection: 'assets',
      id: asset.id,
      overrideAccess: true,
      context: { systemJob: true },
      data: { last_seen: asset.last_seen, host_scripts: asset.host_scripts },
    })
  }
})

for (const operation of ['login', 'refresh-token'] as const) {
  it(`SEC-42: concurrent ${operation} cannot resurrect a deactivated account or sessions`, async () => {
    const user = await findUser('org-viewer@siam.com')
    const cookie = await login(user.email)
    const req = await createLocalReq({}, payload)
    const transactionID = await payload.db.beginTransaction()
    if (!transactionID) throw new Error('Requires transactions')
    req.transactionID = transactionID
    let pending: ReturnType<typeof api> | undefined
    try {
      await payload.update({
        collection: 'users',
        id: user.id,
        req,
        overrideAccess: true,
        data: { status: 'inactive' },
      })
      pending = api(
        `/api/users/${operation}`,
        'POST',
        operation === 'login' ? { email: user.email, password } : undefined,
        cookie
      )
      await waitForRowWaiter()
      await payload.db.commitTransaction(transactionID!)
      expect((await pending).status).toBe(403)
      const current = await payload.db.findOne<{
        id: string
        status: string
        sessions?: unknown[]
      }>({ collection: 'users', where: { id: { equals: user.id } } })
      expect(current?.status).toBe('inactive')
      expect(current?.sessions ?? []).toEqual([])
    } finally {
      await payload.db.rollbackTransaction(transactionID!)
      if (pending) await pending
      await payload.update({
        collection: 'users',
        id: user.id,
        overrideAccess: true,
        data: { status: 'active' },
      })
    }
  })
}

it('SEC-42: membership cascade revokes user sessions, and admin deactivation does too', async () => {
  const user = await findUser('org-viewer@siam.com'),
    userCookie = await login(user.email)
  const membership = (
    await payload.find({
      collection: 'organization-memberships',
      overrideAccess: true,
      where: { user: { equals: user.id } },
    })
  ).docs[0]
  await payload.update({
    collection: 'organization-memberships',
    id: membership.id,
    overrideAccess: true,
    data: { is_active: false },
  })
  expect((await api('/api/users/refresh-token', 'POST', undefined, userCookie)).status).toBe(403)
  const admin = (
    await payload.find({
      collection: 'admins',
      overrideAccess: true,
      where: { email: { equals: 'platform-admin@siam.com' } },
    })
  ).docs[0]
  const adminCookie = await login(admin.email, 'admins')
  await payload.update({
    collection: 'admins',
    id: admin.id,
    overrideAccess: true,
    data: { status: 'inactive' },
  })
  expect((await api('/api/admins/refresh-token', 'POST', undefined, adminCookie)).status).toBe(403)
  expect((await api('/api/v1/session', 'GET', undefined, adminCookie)).status).toBe(401)
})

it('seed: real CLI processes do not run workers or recover a job belonging to another process', async () => {
  const job = await payload.create({
    collection: 'payload-jobs',
    overrideAccess: true,
    data: {
      taskSlug: 'expire-raw-scan-payloads',
      queue: 'maintenance',
      processing: true,
      input: {},
    },
  })
  try {
    for (const script of ['scripts/seed-navigation.ts', 'scripts/seed-demo.ts']) {
      await promisify(execFile)(process.execPath, ['--import', 'tsx', script], {
        cwd: process.cwd(),
        env: { ...process.env, PAYLOAD_DISABLE_JOBS: '0' },
        timeout: 20000,
      })
      const current = await payload.findByID({
        collection: 'payload-jobs',
        id: job.id,
        overrideAccess: true,
      })
      expect(current.processing).toBe(true)
      expect(current.completedAt ?? null).toBeNull()
    }
  } finally {
    await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  }
}, 60000)
