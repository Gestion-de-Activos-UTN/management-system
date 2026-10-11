import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { seedRiskOrganization, member } from '@/domain/risk/risk-integration-seed'
import { MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { claimTask, completeTask } from '@/domain/tasks/task-actions'
import { enqueueRiskRecalculation } from '@/domain/risk/enqueueRiskRecalculation'
import { reconcileExpiredAssetExclusions } from '@/domain/assessments/reconcileExpiredAssetExclusions'
import { relationId } from '@/lib/relationId'

let payload: Payload, config: SanitizedConfig
let org: string, office: string, otherOffice: string, foreignOffice: string, server: string
let admin: string,
  manager: string,
  viewer: string,
  adminCookie: string,
  managerCookie: string,
  viewerCookie: string
const password = 'x'.repeat(12)
const db = () => payload.db as unknown as PostgresAdapter
const scopeWhere = () => ({ concurrencyKey: { equals: `risk:${org}:${office}` } })
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
  return { status: response.status, data: await response.json(), response }
}
async function cookie(id: string) {
  const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
  const result = await api('/api/users/login', 'POST', { email: user.email, password })
  expect(result.status).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}
const createTask = async () => {
  const result = await api(
    '/api/v1/tasks',
    'POST',
    {
      title: 'Concurrent task',
      priority: 'normal',
      global: false,
      office_ids: [office],
      assignment_kind: 'open_pool',
    },
    adminCookie
  )
  expect(result.status).toBe(201)
  return result.data.docs[0].id as string
}

beforeAll(async () => {
  // Deliberately refuse development databases; configure a disposable local cluster explicitly.
  if (
    process.env.DATABASE_URL !== 'postgresql://siam_audit@127.0.0.1:55443/siam_audit_fixes' &&
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_audit_security(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('This suite requires the disposable siam_audit_fixes database on port 55443')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  process.env.PAYLOAD_SECRET = 'siam-disposable-fix-regressions-secret'
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const seed = await seedRiskOrganization(payload)
  org = String(seed.organization.id)
  office = String(seed.office.id)
  server = String(seed.server.id)
  await payload.update({
    collection: 'assets',
    id: server,
    overrideAccess: true,
    context: { systemJob: true },
    data: { identification_status: 'confirmed' },
  })
  otherOffice = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { organization: org, name: 'Other office' },
      })
    ).id
  )
  foreignOffice = String((await seedRiskOrganization(payload)).office.id)
  admin = await member(payload, org, [office, otherOffice], 'org_admin')
  manager = await member(payload, org, [office], 'office_manager')
  viewer = await member(payload, org, [otherOffice], 'org_viewer')
  adminCookie = await cookie(admin)
  managerCookie = await cookie(manager)
  viewerCookie = await cookie(viewer)
})
afterAll(async () => {
  vi.restoreAllMocks()
  if (payload) await payload.destroy()
})

it('SEC-40: cookies cannot unlock; five bad attempts lock the account until lockTime', async () => {
  const roles = await payload.find({
    collection: 'roles',
    overrideAccess: true,
    where: { slug: { equals: 'platform_admin' } },
  })
  const role =
    roles.docs[0] ??
    (await payload.create({
      collection: 'roles',
      overrideAccess: true,
      data: {
        slug: 'platform_admin',
        name: 'Platform',
        rank: 0,
        scope: 'platform',
        is_platform_role: true,
      },
    }))
  const target = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      role: role.id,
      email: `locked-${crypto.randomUUID()}@example.test`,
      password,
      status: 'active',
    },
  })
  const user = await payload.findByID({ collection: 'users', id: manager, overrideAccess: true })
  for (const [collection, account] of [
    ['admins', target],
    ['users', user],
  ] as const) {
    for (let i = 0; i < 5; i++)
      await api(`/api/${collection}/login`, 'POST', {
        email: account.email,
        password: 'wrong-password',
      })
    expect(
      (await api(`/api/${collection}/login`, 'POST', { email: account.email, password })).status
    ).toBe(401)
    for (const actor of [undefined, viewerCookie, adminCookie]) {
      expect(
        (await api(`/api/${collection}/unlock`, 'POST', { email: account.email }, actor)).status
      ).toBe(403)
      expect(
        (await api(`/api/${collection}/unlock`, 'POST', { email: 'missing@example.test' }, actor))
          .status
      ).toBe(403)
    }
    const after = await payload.db.findOne({ collection, where: { id: { equals: account.id } } })
    expect(Date.parse((after as unknown as { lockUntil: string }).lockUntil)).toBeGreaterThan(Date.now())
    // Simulate lockTime elapsing: the account unlocks by itself, no manual unlock needed.
    await payload.db.updateOne({ collection, id: account.id, data: { lockUntil: new Date(Date.now() - 1000).toISOString() } })
    expect(
      (await api(`/api/${collection}/login`, 'POST', { email: account.email, password })).status
    ).toBe(200)
  }
})

it('SEC-27: rejects omitted/foreign/mixed scope and preserves authorized options', async () => {
  expect(
    (await api('/api/v1/tasks/assignment-options', 'GET', undefined, managerCookie)).status
  ).toBe(400)
  for (const query of [
    `office_id=${otherOffice}`,
    `office_ids=${office},${otherOffice}`,
    `office_id=${foreignOffice}`,
  ])
    expect(
      (await api(`/api/v1/tasks/assignment-options?${query}`, 'GET', undefined, managerCookie))
        .status
    ).toBe(403)
  const own = await api(
    `/api/v1/tasks/assignment-options?office_id=${office}`,
    'GET',
    undefined,
    managerCookie
  )
  expect(own.status).toBe(200)
  expect(own.data.users.some((u: { id: string }) => u.id === viewer)).toBe(false)
  expect(own.data.users.some((u: { id: string }) => u.id === admin)).toBe(true)
  expect(
    (
      await api(
        `/api/v1/tasks/assignment-options?office_id=${foreignOffice}`,
        'GET',
        undefined,
        adminCookie
      )
    ).status
  ).toBe(400)
  expect(
    (await api('/api/v1/tasks/assignment-options', 'GET', undefined, adminCookie)).status
  ).toBe(200)
  expect(
    (
      await api(
        '/api/v1/tasks',
        'POST',
        {
          title: 'Global denied',
          priority: 'normal',
          global: true,
          office_ids: [],
          assignment_kind: 'open_pool',
        },
        managerCookie
      )
    ).status
  ).toBe(403)
})

it('SEC-27: reassignment derives scope from an authorized task and rejects overrides', async () => {
  const id = await createTask()
  expect(
    (await api(`/api/v1/tasks/assignment-options?task_id=${id}`, 'GET', undefined, managerCookie))
      .status
  ).toBe(200)
  expect(
    (
      await api(
        `/api/v1/tasks/assignment-options?task_id=${id}&office_id=${otherOffice}`,
        'GET',
        undefined,
        managerCookie
      )
    ).status
  ).toBe(400)
  expect(
    (await api(`/api/v1/tasks/assignment-options?task_id=${id}`, 'GET', undefined, viewerCookie))
      .status
  ).toBe(403)
})

it('VAL-01: network exclusion rejects null and invalid new exclusions with 400', async () => {
  const path = `/api/v1/assets/${server}/business`
  const future = new Date(Date.now() + 10 * 86400000).toISOString()
  expect(
    (
      await api(
        path,
        'PATCH',
        {
          assessment_scope: 'excluded',
          assessment_exclusion_reason: 'temporary_or_lab',
          assessment_excluded_until: future,
        },
        adminCookie
      )
    ).status
  ).toBe(200)
  for (const field of ['assessment_excluded_until', 'assessment_exclusion_reason'])
    expect((await api(path, 'PATCH', { [field]: null }, adminCookie)).status).toBe(400)
  expect(
    (await payload.findByID({ collection: 'assets', id: server, overrideAccess: true }))
      .assessment_excluded_until
  ).toBe(future)
  expect((await api(path, 'PATCH', { alias: 'Unrelated edit' }, adminCookie)).status).toBe(200)
  expect((await api(path, 'PATCH', { assessment_scope: 'included' }, adminCookie)).status).toBe(200)
  expect(
    (
      await api(
        path,
        'PATCH',
        {
          assessment_scope: 'excluded',
          assessment_exclusion_reason: 'temporary_or_lab',
          assessment_excluded_until: null,
        },
        adminCookie
      )
    ).status
  ).toBe(400)
})

it('VAL-01: manual exclusions use the same rule and expiration job is repeatable', async () => {
  const created = await api(
    '/api/non-network-assets',
    'POST',
    {
      alias: 'Manual regression',
      asset_category: MANUAL_ASSET_CATEGORY_VALUES[0],
      criticality: 'medium',
      owner: admin,
      office,
      review_interval: 'never',
      assessment_scope: 'excluded',
      assessment_exclusion_reason: 'temporary_or_lab',
      assessment_excluded_until: new Date(Date.now() + 86400000).toISOString(),
    },
    adminCookie
  )
  expect(created.status).toBe(201)
  const id = created.data.doc.id
  expect(
    (
      await api(
        `/api/non-network-assets/${id}`,
        'PATCH',
        { assessment_excluded_until: null },
        adminCookie
      )
    ).status
  ).toBe(400)
  await reconcileExpiredAssetExclusions(payload, new Date(Date.now() + 2 * 86400000))
  expect(
    (await payload.findByID({ collection: 'non-network-assets', id, overrideAccess: true }))
      .assessment_scope
  ).toBe('included')
  const repeated = await reconcileExpiredAssetExclusions(
    payload,
    new Date(Date.now() + 2 * 86400000)
  )
  expect(repeated.manual_assets_reincluded).toBe(0)
})

it('VAL-02: rejects implicit inverted dates and allows ordered past dates/title edits', async () => {
  const base = {
    title: 'Dates regression',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'open_pool',
  }
  const due = new Date(Date.now() - 86400000).toISOString()
  expect((await api('/api/v1/tasks', 'POST', { ...base, due_at: due }, adminCookie)).status).toBe(
    400
  )
  const created = await api(
    '/api/v1/tasks',
    'POST',
    { ...base, start_at: new Date(Date.now() - 2 * 86400000).toISOString(), due_at: due },
    adminCookie
  )
  expect(created.status).toBe(201)
  expect(
    (
      await api(
        `/api/v1/tasks/${created.data.docs[0].id}`,
        'PATCH',
        { title: 'Valid title edit' },
        adminCookie
      )
    ).status
  ).toBe(200)
})

it('SEC-59: failed real COMMIT rejects, rolls back, cleans up; explicit rollback works', async () => {
  await db().drizzle.execute(
    sql`CREATE TABLE IF NOT EXISTS audit_commit_parent (id int PRIMARY KEY)`
  )
  await db().drizzle.execute(
    sql`CREATE TABLE IF NOT EXISTS audit_commit_child (id int PRIMARY KEY, parent int REFERENCES audit_commit_parent(id) DEFERRABLE INITIALLY DEFERRED)`
  )
  const tx = await payload.db.beginTransaction()
  const session = payload.db.sessions![tx!]
  await (session.db as PostgresAdapter['drizzle']).execute(
    sql`INSERT INTO audit_commit_child VALUES (1,999)`
  )
  await expect(payload.db.commitTransaction(tx!)).rejects.toThrow()
  expect(payload.db.sessions![tx!]).toBeUndefined()
  const rows = await db().pool.query('SELECT count(*)::int AS count FROM audit_commit_child')
  expect(rows.rows[0].count).toBe(0)
  const rollback = await payload.db.beginTransaction()
  await expect(payload.db.rollbackTransaction(rollback!)).resolves.toBeUndefined()
})

it('SEC-54: a waiting claimant gets 409 and cannot replace the winner', async () => {
  const id = await createTask()
  const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  const ctx = await getTenantContext(req)
  const tx = await payload.db.beginTransaction()
  req.transactionID = tx!
  let committed = false
  try {
    await claimTask(req, ctx!, id)
    const competing = api(`/api/v1/tasks/${id}/claim`, 'POST', {}, managerCookie)
    let blocked = false
    for (let i = 0; i < 100; i++) {
      const locks = await db().pool.query(
        "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted"
      )
      if (locks.rows[0].count) {
        blocked = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    await payload.db.commitTransaction(tx!)
    committed = true
    expect((await competing).status).toBe(409)
    expect(blocked).toBe(true)
    const task = await payload.findByID({ collection: 'tasks', id, overrideAccess: true })
    expect(relationId(task.claimed_by)).toBe(admin)
  } finally {
    if (!committed) await payload.db.rollbackTransaction(tx!)
  }
})

it.each(['delete', 'cancel'])(
  'SEC-54: incompatible %s waits and cannot overwrite the winning command',
  async action => {
    const id = await createTask()
    if (action === 'cancel')
      expect((await api(`/api/v1/tasks/${id}/claim`, 'POST', {}, adminCookie)).status).toBe(200)
    const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
    const ctx = await getTenantContext(req)
    const tx = await payload.db.beginTransaction()
    req.transactionID = tx!
    let committed = false
    try {
      if (action === 'delete') await claimTask(req, ctx!, id)
      else await completeTask(req, ctx!, id)
      const competing =
        action === 'delete'
          ? api(`/api/v1/tasks/${id}`, 'DELETE', undefined, managerCookie)
          : api(
              `/api/v1/tasks/${id}/cancel`,
              'POST',
              { reason: 'Concurrent cancellation' },
              managerCookie
            )
      let blocked = false
      for (let i = 0; i < 100; i++) {
        const locks = await db().pool.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted"
        )
        if (locks.rows[0].count) {
          blocked = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      await payload.db.commitTransaction(tx!)
      committed = true
      expect((await competing).status).toBe(409)
      expect(blocked).toBe(true)
      const task = await payload.findByID({ collection: 'tasks', id, overrideAccess: true })
      expect(task.status).toBe(action === 'delete' ? 'in_progress' : 'completed')
    } finally {
      if (!committed) await payload.db.rollbackTransaction(tx!)
    }
  }
)

it('SEC-57: startup releases maintenance, and the runner completes the recovered job', async () => {
  const job = await payload.jobs.queue({
    task: 'reconcile-expired-asset-exclusions',
    queue: 'maintenance',
    input: {},
    meta: { scheduled: true },
  })
  await payload.update({
    collection: 'payload-jobs',
    id: job.id,
    overrideAccess: true,
    data: { processing: true },
  })
  await config.onInit!(payload)
  expect(
    (await payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true }))
      .processing
  ).toBe(false)
  await payload.jobs.run({ queue: 'maintenance' })
  await expect(
    payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  ).rejects.toThrow()
})

it('SEC-57: a freshly started application process recovers persisted maintenance state', async () => {
  const job = await payload.jobs.queue({
    task: 'reconcile-expired-asset-exclusions',
    queue: 'maintenance',
    input: {},
    meta: { scheduled: true },
  })
  await payload.update({
    collection: 'payload-jobs',
    id: job.id,
    overrideAccess: true,
    data: { processing: true },
  })
  // No worker is active in this harness. The child runs the application's real startup hook.
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { getPayload } from 'payload';
    const config = await (await import('./payload.config.ts')).default;
    config.typescript.autoGenerate = false;
    config.admin.importMap.autoGenerate = false;
    config.jobs.autoRun = [];
    const app = await getPayload({ config });
    await app.destroy();
    process.exit(0);
  `,
    ],
    { cwd: process.cwd(), env: { ...process.env, PAYLOAD_DISABLE_JOBS: '1' }, timeout: 20000 }
  )
  expect(
    (await payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true }))
      .processing
  ).toBe(false)
  await payload.jobs.run({ queue: 'maintenance' })
  await expect(
    payload.findByID({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
  ).rejects.toThrow()
})

it('SEC-58: jobs are invisible before parent commit; rollback removes both change and jobs', async () => {
  delete process.env.PAYLOAD_DISABLE_JOBS
  const req = await createLocalReq({ user: { id: admin, collection: 'users' } as never }, payload)
  const tx = await payload.db.beginTransaction()
  req.transactionID = tx!
  try {
    await payload.update({
      collection: 'assets',
      id: server,
      req,
      overrideAccess: true,
      data: { criticality: 'low' },
    })
    expect(
      (
        await payload.find({
          collection: 'payload-jobs',
          overrideAccess: true,
          where: scopeWhere(),
        })
      ).totalDocs
    ).toBe(0)
    expect(
      (
        await payload.find({
          collection: 'payload-jobs',
          overrideAccess: true,
          req,
          where: scopeWhere(),
        })
      ).totalDocs
    ).toBe(1)
    await payload.db.rollbackTransaction(tx!)
    expect(
      (await payload.findByID({ collection: 'assets', id: server, overrideAccess: true }))
        .criticality
    ).toBe('critical')
    expect(
      (
        await payload.find({
          collection: 'payload-jobs',
          overrideAccess: true,
          where: scopeWhere(),
        })
      ).totalDocs
    ).toBe(0)
  } finally {
    await payload.db.rollbackTransaction(tx!)
    process.env.PAYLOAD_DISABLE_JOBS = '1'
  }
})

it('SEC-36/58: failed replacement preserves previous jobs and rolls back the policy', async () => {
  delete process.env.PAYLOAD_DISABLE_JOBS
  await enqueueRiskRecalculation(payload, org, [office])
  const previous = await payload.find({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: scopeWhere(),
  })
  const original = payload.db.create.bind(payload.db)
  const spy = vi.spyOn(payload.db, 'create').mockImplementation(async args => {
    if (args.collection === 'payload-jobs') throw new Error('Synthetic job INSERT failure')
    return original(args)
  })
  try {
    const response = await api(
      '/api/v1/organization/assessment-policy',
      'PATCH',
      { policy_key: 'reinforced', policy_version: 2 },
      adminCookie
    )
    expect(response.status).toBe(400)
    const settings = await payload.find({
      collection: 'organization-settings',
      overrideAccess: true,
      where: { organization: { equals: org } },
    })
    expect(settings.docs[0].assessment_policy_key).toBe('essential')
    const retained = await payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: scopeWhere(),
    })
    expect(retained.docs.map(j => j.id)).toEqual(previous.docs.map(j => j.id))
  } finally {
    spy.mockRestore()
    process.env.PAYLOAD_DISABLE_JOBS = '1'
  }
})

it('SEC-36/58: committed mutation exposes pending risk and worker calculates confirmed state', async () => {
  delete process.env.PAYLOAD_DISABLE_JOBS
  try {
    const changed = await api(
      `/api/v1/assets/${server}/business`,
      'PATCH',
      { criticality: 'low' },
      adminCookie
    )
    expect(changed.status).toBe(200)
    expect(
      (await api(`/api/v1/risk/latest?office_id=${office}`, 'GET', undefined, adminCookie)).data
        .recalculation
    ).toBe('pending')
    for (let i = 0; i < 5; i++) await payload.jobs.run({ queue: 'risk', limit: 20 })
    const latest = await api(
      `/api/v1/risk/latest?office_id=${office}`,
      'GET',
      undefined,
      adminCookie
    )
    expect(latest.data.recalculation).toBe('current')
    const contributions = await payload.find({
      collection: 'risk-contributions',
      overrideAccess: true,
      where: { evaluation: { equals: latest.data.evaluation.id } },
      limit: 1000,
    })
    expect(
      contributions.docs
        .filter(c => c.asset_key === `asset:${server}`)
        .every(c => c.criticality === 'low')
    ).toBe(true)
    expect(contributions.docs.some(c => c.asset_key === `asset:${server}`)).toBe(true)
  } finally {
    process.env.PAYLOAD_DISABLE_JOBS = '1'
  }
})
