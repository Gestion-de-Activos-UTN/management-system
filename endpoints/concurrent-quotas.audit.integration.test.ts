import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { member } from '@/domain/risk/risk-integration-seed'
import { transactionLock } from '@/domain/with-transaction'
import { organizationAdminLock } from '@/domain/organizations/admin-actions'
import { withScannerFixture } from '@/domain/agents/scanner-source-fixture'
import { withAgentQuotaLock } from '@/domain/subscriptions/agent-quota'
import * as packages from '@/domain/agents/buildAgentPackage'
import { relationId } from '@/lib/relationId'

let payload: Payload, config: SanitizedConfig
const password = 'x'.repeat(12)
// Independent expectations: a regression in product defaults must not change the assertions.
const plans = {
  basic: { offices: 3, managers: 2, viewers: 4, admins: 1, agents: 1 },
  premium: { offices: 10, managers: 10, viewers: 20, admins: 3, agents: 2 },
} as const
type Plan = keyof typeof plans
type Role = 'org_admin' | 'office_manager' | 'org_viewer'

async function api(path: string, cookie: string, body: unknown, method = 'POST') {
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost/api${path}`, {
      method,
      headers: { origin: 'http://localhost:3001', cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const zip = response.headers.get('content-type')?.includes('application/zip')
  return {
    status: response.status,
    data: zip ? null : await response.json(),
    bytes: zip ? new Uint8Array(await response.arrayBuffer()) : null,
  }
}

async function fixture(plan: Plan) {
  const org = await payload.create({
    collection: 'organizations',
    overrideAccess: true,
    data: { name: `Cuotas ${randomUUID()}` },
  })
  await payload.create({
    collection: 'organization-settings',
    overrideAccess: true,
    data: {
      organization: org.id,
      industry: 'Technology',
      assessment_policy_key: 'essential',
      assessment_policy_version: 2,
      assessment_policy_selected_at: new Date().toISOString(),
    },
  })
  const limits = plans[plan]
  await payload.create({
    collection: 'subscriptions',
    overrideAccess: true,
    data: {
      organization: org.id,
      level: plan,
      max_offices: limits.offices,
      user_limits: {
        org_admin: limits.admins,
        office_manager: limits.managers,
        org_viewer: limits.viewers,
      },
    },
  })
  const office = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: org.id, name: 'Oficina principal', province_id: '82' },
  })
  const admin = await member(payload, String(org.id), [String(office.id)], 'org_admin')
  const user = await payload.findByID({ collection: 'users', id: admin, overrideAccess: true })
  const login = await handleEndpoints({
    config,
    request: new Request('http://localhost/api/users/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    }),
  })
  expect(login.status).toBe(200)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  return { org: String(org.id), office: String(office.id), cookie, plan }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function memberships(f: Fixture) {
  return (
    await payload.find({
      collection: 'organization-memberships',
      overrideAccess: true,
      where: { organization: { equals: f.org } },
      depth: 1,
      pagination: false,
    })
  ).docs
}
async function addMember(f: Fixture, role: Role, active = true) {
  const id = await member(payload, f.org, [f.office], role)
  if (!active) {
    const membership = (await memberships(f)).find(m => relationId(m.user) === id)!
    await payload.update({
      collection: 'organization-memberships',
      id: membership.id,
      overrideAccess: true,
      data: { is_active: false },
    })
  }
  return id
}
async function fillMembers(f: Fixture, role: Role, count: number) {
  for (let i = 0; i < count; i++) await addMember(f, role)
}
function createMember(f: Fixture, role: Role) {
  const body = {
    name: 'Persona de prueba',
    email: `quota-${randomUUID()}@example.test`,
    password,
    role,
    office_ids: role === 'org_admin' ? [] : [f.office],
  }
  return { email: body.email, run: () => api('/v1/org-members', f.cookie, body) }
}
const activateMember = (f: Fixture, id: string) =>
  api(`/v1/org-members/${id}`, f.cookie, { is_active: true }, 'PATCH')

async function offices(f: Fixture) {
  return (
    await payload.find({
      collection: 'offices',
      overrideAccess: true,
      where: { organization: { equals: f.org } },
      depth: 0,
      pagination: false,
    })
  ).docs
}
async function addOffice(f: Fixture, active = true) {
  return payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: {
      organization: f.org,
      name: `Oficina ${randomUUID()}`,
      province_id: '82',
      is_active: active,
    },
  })
}
const createOffice = (f: Fixture) =>
  api('/v1/offices', f.cookie, { name: `Oficina ${randomUUID()}`, province_id: '82' })
const activateOffice = (f: Fixture, id: string) =>
  api(`/v1/offices/${id}/status`, f.cookie, { is_active: true })

// Hold the real organization lock until BOTH HTTP commands are waiting. This proves overlap;
// Promise.all alone can pass even when a broken check+write happens to execute sequentially.
async function race(
  f: Fixture,
  commands: [
    () => Promise<Awaited<ReturnType<typeof api>>>,
    () => Promise<Awaited<ReturnType<typeof api>>>,
  ]
) {
  const tx = await payload.db.beginTransaction()
  if (!tx) throw new Error('PostgreSQL transaction required')
  const req = await createLocalReq({}, payload)
  req.transactionID = tx
  await transactionLock(req, organizationAdminLock(f.org))
  const pending = commands.map(command => command())
  let waiting = 0
  try {
    const pool = (
      payload.db as unknown as {
        pool: { query: (sql: string) => Promise<{ rows: { count: number }[] }> }
      }
    ).pool
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const locks = await pool.query(
        "SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())"
      )
      waiting = locks.rows[0].count
      if (waiting >= 2) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  } finally {
    await payload.db.rollbackTransaction(tx)
  }
  const results = await Promise.all(pending)
  expect(waiting, 'Both contenders must actually wait on the real lock').toBeGreaterThanOrEqual(2)
  return results
}
function oneWinner(results: Awaited<ReturnType<typeof api>>[], code: string) {
  expect(results.filter(r => r.status === 200 || r.status === 201)).toHaveLength(1)
  const rejected = results.filter(r => r.status === 409)
  expect(rejected).toHaveLength(1)
  expect(rejected[0].data.error).toBe(code)
  return results.findIndex(r => r.status === 200 || r.status === 201)
}

beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_quotas_[a-z0-9]+$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use a fresh disposable siam_quotas_* database on port 55443')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  expect(
    (await payload.count({ collection: 'organizations', overrideAccess: true })).totalDocs
  ).toBe(0)
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (payload) await payload.destroy()
})

for (const plan of ['basic', 'premium'] as const) {
  for (const role of ['office_manager', 'org_viewer'] as const) {
    it(`${plan}: concurrent ${role} creates compete for one slot without orphan users`, async () => {
      const f = await fixture(plan)
      const limit = role === 'office_manager' ? plans[plan].managers : plans[plan].viewers
      await fillMembers(f, role, limit - 1)
      const commands = [createMember(f, role), createMember(f, role)] as const
      const winner = oneWinner(
        await race(f, [commands[0].run, commands[1].run]),
        'user_limit_reached'
      )
      const rows = await memberships(f)
      expect(
        rows.filter(m => m.is_active && typeof m.role === 'object' && m.role?.slug === role)
      ).toHaveLength(limit)
      for (let i = 0; i < commands.length; i++) {
        const users = await payload.find({
          collection: 'users',
          overrideAccess: true,
          where: { email: { equals: commands[i].email } },
          depth: 0,
        })
        expect(users.totalDocs).toBe(i === winner ? 1 : 0)
      }
      expect(rows).toHaveLength(limit + 1)
    }, 60000)
  }

  for (const scenario of [
    'create-reactivate',
    'reactivate-reactivate',
    'change-role-create',
  ] as const) {
    it(`${plan}: ${scenario} shares the same last user slot`, async () => {
      const f = await fixture(plan)
      const changing = scenario === 'change-role-create'
      const role = changing ? 'office_manager' : 'org_viewer'
      const limit = changing ? plans[plan].managers : plans[plan].viewers
      await fillMembers(f, role, limit - 1)
      const first = await addMember(f, 'org_viewer', changing)
      const second =
        scenario === 'reactivate-reactivate' ? await addMember(f, 'org_viewer', false) : null
      const creation = createMember(f, role)
      const results = await race(f, [
        () =>
          changing
            ? api(`/v1/org-members/${first}`, f.cookie, { role }, 'PATCH')
            : activateMember(f, first),
        () => (second ? activateMember(f, second) : creation.run()),
      ])
      oneWinner(results, 'user_limit_reached')
      const rows = await memberships(f)
      expect(
        rows.filter(m => m.is_active && typeof m.role === 'object' && m.role?.slug === role)
      ).toHaveLength(limit)
      const account = await payload.findByID({
        collection: 'users',
        id: first,
        overrideAccess: true,
      })
      const firstMembership = rows.find(m => relationId(m.user) === first)!
      expect(firstMembership.is_active).toBe(changing || results[0].status === 200)
      expect(account.status).toBe(firstMembership.is_active ? 'active' : 'inactive')
      if (changing)
        expect(typeof firstMembership.role === 'object' && firstMembership.role?.slug).toBe(
          results[0].status === 200 ? 'office_manager' : 'org_viewer'
        )
      if (!second)
        expect(
          (
            await payload.count({
              collection: 'users',
              overrideAccess: true,
              where: { email: { equals: creation.email } },
            })
          ).totalDocs
        ).toBe(results[1].status === 201 ? 1 : 0)
    }, 60000)
  }

  it(`${plan}: deactivation frees a user slot; inactive edits do not consume it`, async () => {
    const f = await fixture(plan)
    await fillMembers(f, 'org_viewer', plans[plan].viewers)
    const inactive = await addMember(f, 'org_viewer', false)
    expect((await activateMember(f, inactive)).data.error).toBe('user_limit_reached')
    expect(
      (await api(`/v1/org-members/${inactive}`, f.cookie, { office_ids: [f.office] }, 'PATCH'))
        .status
    ).toBe(200)
    expect(
      (await payload.findByID({ collection: 'users', id: inactive, overrideAccess: true })).status
    ).toBe('inactive')
    const active = (await memberships(f)).find(
      m => m.is_active && typeof m.role === 'object' && m.role?.slug === 'org_viewer'
    )!
    const user = await payload.findByID({
      collection: 'users',
      id: relationId(active.user),
      overrideAccess: true,
    })
    expect(
      (
        await api(
          `/v1/org-members/${user.id}`,
          f.cookie,
          { is_active: false, confirm_email: user.email },
          'PATCH'
        )
      ).status
    ).toBe(200)
    expect((await activateMember(f, inactive)).status).toBe(200)
    expect(
      (await memberships(f)).filter(
        m => m.is_active && typeof m.role === 'object' && m.role?.slug === 'org_viewer'
      )
    ).toHaveLength(plans[plan].viewers)
  }, 60000)

  it(`${plan}: two role changes compete for the last manager slot`, async () => {
    const f = await fixture(plan)
    await fillMembers(f, 'office_manager', plans[plan].managers - 1)
    const ids = [await addMember(f, 'org_viewer'), await addMember(f, 'org_viewer')]
    const results = await race(f, [
      () => api(`/v1/org-members/${ids[0]}`, f.cookie, { role: 'office_manager' }, 'PATCH'),
      () => api(`/v1/org-members/${ids[1]}`, f.cookie, { role: 'office_manager' }, 'PATCH'),
    ])
    const winner = oneWinner(results, 'user_limit_reached')
    const rows = await memberships(f)
    for (let i = 0; i < ids.length; i++) {
      const row = rows.find(m => relationId(m.user) === ids[i])!
      expect(row.is_active).toBe(true)
      expect(typeof row.role === 'object' && row.role?.slug).toBe(
        i === winner ? 'office_manager' : 'org_viewer'
      )
    }
    expect(
      rows.filter(
        m => m.is_active && typeof m.role === 'object' && m.role?.slug === 'office_manager'
      )
    ).toHaveLength(plans[plan].managers)
  }, 60000)

  it(`${plan}: administrator quota includes the authenticated administrator`, async () => {
    const f = await fixture(plan)
    if (plan === 'basic') {
      const creation = createMember(f, 'org_admin')
      expect((await creation.run()).data.error).toBe('user_limit_reached')
      expect(
        (
          await payload.count({
            collection: 'users',
            overrideAccess: true,
            where: { email: { equals: creation.email } },
          })
        ).totalDocs
      ).toBe(0)
    } else {
      await fillMembers(f, 'org_admin', plans[plan].admins - 2)
      oneWinner(
        await race(f, [createMember(f, 'org_admin').run, createMember(f, 'org_admin').run]),
        'user_limit_reached'
      )
    }
    expect(
      (await memberships(f)).filter(
        m => m.is_active && typeof m.role === 'object' && m.role?.slug === 'org_admin'
      )
    ).toHaveLength(plans[plan].admins)
  }, 60000)

  for (const scenario of ['create-create', 'create-reactivate', 'reactivate-reactivate'] as const) {
    it(`${plan}: office ${scenario} cannot exceed the plan`, async () => {
      const f = await fixture(plan)
      for (let i = 1; i < plans[plan].offices - 1; i++) await addOffice(f)
      const inactive = scenario !== 'create-create' ? await addOffice(f, false) : null
      const other = scenario === 'reactivate-reactivate' ? await addOffice(f, false) : null
      const before = (await offices(f)).length
      const results = await race(f, [
        () => (other ? activateOffice(f, String(other.id)) : createOffice(f)),
        () => (inactive ? activateOffice(f, String(inactive.id)) : createOffice(f)),
      ])
      oneWinner(results, 'office_limit_reached')
      const rows = await offices(f)
      expect(rows.filter(o => o.is_active)).toHaveLength(plans[plan].offices)
      expect(rows).toHaveLength(before + results.filter(r => r.status === 201).length)
      if (inactive)
        expect(rows.find(o => o.id === inactive.id)?.is_active).toBe(results[1].status === 200)
      if (other)
        expect(rows.find(o => o.id === other.id)?.is_active).toBe(results[0].status === 200)
    }, 60000)
  }

  it(`${plan}: an office slot can be reused after deactivation`, async () => {
    const f = await fixture(plan)
    for (let i = 1; i < plans[plan].offices; i++) await addOffice(f)
    expect((await createOffice(f)).data.error).toBe('office_limit_reached')
    const target = (await offices(f)).find(o => String(o.id) !== f.office)!
    expect(
      (
        await api(`/v1/offices/${target.id}/status`, f.cookie, {
          is_active: false,
          confirm_name: target.name,
          manual_asset_decisions: [],
        })
      ).status
    ).toBe(200)
    expect((await createOffice(f)).status).toBe(201)
    expect((await offices(f)).filter(o => o.is_active)).toHaveLength(plans[plan].offices)
    expect((await activateOffice(f, String(target.id))).data.error).toBe('office_limit_reached')
  }, 60000)

  it(`${plan}: concurrent provisioning retains just one credential for the last office slot`, async () => {
    await withScannerFixture(async () => {
      const f = await fixture(plan)
      for (let i = 0; i < plans[plan].agents - 1; i++) await addAgent(f)
      // Hold the actual per-process queue, not a replacement/mock of its critical section.
      let release!: () => void, entered!: () => void
      const ready = new Promise<void>(resolve => {
        entered = resolve
      })
      const blocker = withAgentQuotaLock(f.org, async () => {
        entered()
        await new Promise<void>(resolve => {
          release = resolve
        })
      })
      await ready
      let built = 0,
        bothBuilt!: () => void
      const packagesReady = new Promise<void>(resolve => {
        bothBuilt = resolve
      })
      const build = packages.buildAgentPackage
      const spy = vi.spyOn(packages, 'buildAgentPackage').mockImplementation(async options => {
        const bytes = await build(options)
        if (++built === 2) bothBuilt()
        return bytes
      })
      const pending = [provision(f), provision(f)]
      try {
        await Promise.race([
          packagesReady,
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Both real packages must finish')),
              10000
            )
            timer.unref()
          }),
        ])
        await new Promise(resolve => setImmediate(resolve))
      } finally {
        release()
        await blocker
        spy.mockRestore()
      }
      const results = await Promise.all(pending)
      oneWinner(results, 'agent_limit_reached')
      const rows = await agents(f)
      expect(rows).toHaveLength(plans[plan].agents)
      expect(rows.filter(a => a.is_active && a.lifecycle_status === 'provisioned')).toHaveLength(
        plans[plan].agents
      )
      expect(new Set(rows.map(a => a.apiKeyPrefix)).size).toBe(rows.length)
      for (const a of rows) {
        expect(a.apiKeyHash).toBeTruthy()
        expect(a.apiKey).toBeFalsy()
      }
      expect(results.find(r => r.status === 201)?.bytes?.byteLength).toBeGreaterThan(100)
      const archive = await JSZip.loadAsync(results.find(r => r.status === 201)!.bytes!)
      const envFile = Object.keys(archive.files).find(
        name => name.endsWith('/.env') || name === '.env'
      )!
      const env = await archive.file(envFile)!.async('string')
      const token = env.match(/^PLATFORM_TOKEN=(.+)$/m)![1].trim()
      const id = env.match(/^AGENT_ID=(.+)$/m)![1].trim()
      const persisted = rows.find(a => a.id === id)!
      expect(persisted.apiKeyPrefix).toBe(token.slice(0, 8))
      expect(await bcrypt.compare(token, persisted.apiKeyHash!)).toBe(true)
    })
  }, 60000)

  it(`${plan}: revocation frees scanner quota while retaining the revoked history`, async () => {
    await withScannerFixture(async () => {
      const f = await fixture(plan)
      for (let i = 0; i < plans[plan].agents; i++) await addAgent(f)
      expect((await provision(f)).data.error).toBe('agent_limit_reached')
      const old = (await agents(f))[0]
      expect((await api(`/v1/agents/${old.id}/revoke`, f.cookie, {})).status).toBe(200)
      expect((await provision(f)).status).toBe(201)
      const rows = await agents(f)
      expect(rows).toHaveLength(plans[plan].agents + 1)
      expect(rows.filter(a => a.lifecycle_status !== 'revoked')).toHaveLength(plans[plan].agents)
      expect(rows.find(a => a.id === old.id)?.is_active).toBe(false)
    })
  }, 60000)

  it(`${plan}: a full office does not consume a different office's scanner slots`, async () => {
    await withScannerFixture(async () => {
      const f = await fixture(plan)
      for (let i = 0; i < plans[plan].agents; i++) await addAgent(f)
      const second = await addOffice(f)
      const results = await Promise.all([
        provision(f),
        provision({ ...f, office: String(second.id) }),
      ])
      expect(results[0].status).toBe(409)
      expect(results[0].data.error).toBe('agent_limit_reached')
      expect(results[1].status).toBe(201)
      expect(
        (await agents(f)).filter(a => relationId(a.office) === String(second.id))
      ).toHaveLength(1)
    })
  }, 60000)

  it(`${plan}: package IO failure leaves no credential or consumed scanner slot and permits retry`, async () => {
    await withScannerFixture(async () => {
      const f = await fixture(plan)
      const source = process.env.SCANNER_SOURCE_ROOT
      try {
        process.env.SCANNER_SOURCE_ROOT = `/tmp/siam-missing-scanner-${randomUUID()}`
        expect((await provision(f)).status).toBe(500)
        expect(await agents(f)).toHaveLength(0)
      } finally {
        process.env.SCANNER_SOURCE_ROOT = source
      }
      expect((await provision(f)).status).toBe(201)
      expect(await agents(f)).toHaveLength(1)
    })
  }, 60000)

  it(`${plan}: a failed scanner write releases the quota queue and permits retry`, async () => {
    await withScannerFixture(async () => {
      const f = await fixture(plan)
      const hooks = payload.collections.agents.config.hooks!.beforeChange!
      let credentialPrepared = false
      // Inject after the real credential hook, before persistence. Do not simulate an error
      // after a committed write: that would be a different, undefined retry contract (T-11).
      const fail: (typeof hooks)[number] = ({ data, operation }) => {
        if (operation === 'create') {
          credentialPrepared = Boolean(data.apiKeyHash && data.apiKeyPrefix)
          throw new Error('Controlled scanner persistence failure')
        }
        return data
      }
      hooks.push(fail)
      try {
        expect((await provision(f)).status).toBe(500)
        expect(credentialPrepared).toBe(true)
        expect(await agents(f)).toHaveLength(0)
      } finally {
        hooks.splice(hooks.indexOf(fail), 1)
      }
      expect((await provision(f)).status).toBe(201)
      expect(await agents(f)).toHaveLength(1)
    })
  }, 60000)
}

async function agents(f: Fixture) {
  return (
    await payload.find({
      collection: 'agents',
      overrideAccess: true,
      where: { organization: { equals: f.org } },
      depth: 0,
      pagination: false,
    })
  ).docs
}
async function addAgent(f: Fixture) {
  return payload.create({
    collection: 'agents',
    overrideAccess: true,
    data: { id: `agent-${randomUUID()}`, office: f.office, lifecycle_status: 'provisioned' },
  })
}
const provision = (f: Fixture) => api('/v1/agents/provision', f.cookie, { office_id: f.office })
