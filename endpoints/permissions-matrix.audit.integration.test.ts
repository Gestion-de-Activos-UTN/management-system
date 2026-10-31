import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  getPayload,
  handleEndpoints,
  type CollectionSlug,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { relationId } from '@/lib/relationId'
import { reconcileAssessmentInstance } from '@/domain/assessments/reconcileAssessmentInstance'

let payload: Payload, config: SanitizedConfig, platform: string
let own: Fixture, foreign: Fixture, inactive: Fixture
const password = 'x'.repeat(12)
const missingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tracked = [
  'organizations',
  'organization-settings',
  'subscriptions',
  'offices',
  'users',
  'admins',
  'organization-memberships',
  'agents',
  'assets',
  'non-network-assets',
  'tasks',
  'scan-reports',
  'inventory-snapshots',
  'assessment-instances',
  'assessment-answers',
  'compliance-results',
  'risk-evaluations',
  'portal-messages',
  'portal-message-receipts',
  'payload-jobs',
] as const satisfies readonly CollectionSlug[]
const routeChecks: Array<{ actor: string; method: string; path: string; status: number }> = []

async function api(path: string, cookie = '', method = 'GET', body?: unknown) {
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost/api${path}`, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  })
  const text = await response.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    data = { nonJson: true }
  }
  return { status: response.status, data, response }
}
async function login(id: string, collection: 'users' | 'admins' = 'users') {
  const account = await payload.findByID({ collection, id, overrideAccess: true })
  const result = await api(`/${collection}/login`, '', 'POST', { email: account.email, password })
  expect(result.status, JSON.stringify(result.data)).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}
async function versions() {
  return Object.fromEntries(
    await Promise.all(
      tracked.map(async collection => {
        const rows = await payload.find({
          collection,
          overrideAccess: true,
          pagination: false,
          depth: 0,
        })
        return [
          collection,
          rows.docs
            .map(d => ({ id: String(d.id), updatedAt: d.updatedAt }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ]
      })
    )
  )
}
async function makeFixture(label: string) {
  const seed = await seedRiskOrganization(payload)
  const org = String(seed.organization.id),
    office = String(seed.office.id)
  const second = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: org, name: `${label} segunda oficina` },
  })
  const subscription = (
    await payload.find({
      collection: 'subscriptions',
      overrideAccess: true,
      where: { organization: { equals: org } },
      depth: 0,
    })
  ).docs[0]
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    overrideAccess: true,
    data: {
      features: {
        tasks: true,
        risk_score: true,
        security_assessments: true,
        asset_inventory: true,
      },
    },
  })
  await payload.update({
    collection: 'assets',
    id: seed.server.id,
    overrideAccess: true,
    data: { alias: `${label} servidor privado` },
  })
  const admin = await member(payload, org, [office, String(second.id)], 'org_admin')
  const manager = await member(payload, org, [office], 'office_manager')
  const viewer = await member(payload, org, [office], 'org_viewer')
  const adminCookie = await login(admin),
    managerCookie = await login(manager),
    viewerCookie = await login(viewer)
  const identified = await api(`/v1/assets/${seed.server.id}/identify`, adminCookie, 'PATCH', {
    confirmed_type: 'server',
    authorization_status: 'authorized',
  })
  expect(identified.status).toBe(200)
  const created = await api('/v1/tasks', adminCookie, 'POST', {
    title: `${label} tarea privada`,
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'open_pool',
  })
  expect(created.status, JSON.stringify(created.data)).toBe(201)
  const snapshot = await api('/v1/inventory-snapshots/generate', adminCookie, 'POST', {
    office_id: office,
  })
  expect(snapshot.status, JSON.stringify(snapshot.data)).toBe(201)
  const report = await payload.create({
    collection: 'scan-reports',
    overrideAccess: true,
    data: {
      id: `report-${randomUUID()}`,
      agent: relationId(seed.server.agent),
      office,
      display_name: `${label} informe privado`,
      execution_status: 'completed',
    },
  })
  await reconcileAssessmentInstance(
    payload,
    { scope: 'office', id: office, organizationId: org, is_active: true },
    'initial'
  )
  const assessment = (
    await payload.find({
      collection: 'assessment-instances',
      overrideAccess: true,
      where: {
        and: [
          { organization: { equals: org } },
          { scope: { equals: 'office' } },
          { office: { equals: office } },
        ],
      },
      depth: 0,
      limit: 1,
    })
  ).docs[0]
  expect(assessment).toBeTruthy()
  return {
    org,
    office,
    second: String(second.id),
    asset: String(seed.server.id),
    agent: relationId(seed.server.agent),
    task: String(created.data.docs[0].id),
    snapshot: String(snapshot.data.id),
    report: String(report.id),
    assessment: String(assessment.id),
    admin,
    manager,
    viewer,
    adminCookie,
    managerCookie,
    viewerCookie,
    label,
    name: seed.organization.name,
  }
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>
type Write = {
  name: string
  method: string
  path: (f: Fixture) => string
  body: (f: Fixture) => unknown
  managerDenied?: boolean
  staffStatus?: number
}
const settings = {
  offline_after_hours: 24,
  snapshot_before_each_scan: false,
  snapshot_interval_days: 7,
}
const writes: Write[] = [
  {
    name: 'asset business',
    method: 'PATCH',
    path: f => `/v1/assets/${f.asset}/business`,
    body: () => ({ alias: 'Edición de prueba' }),
  },
  {
    name: 'identify',
    method: 'PATCH',
    path: f => `/v1/assets/${f.asset}/identify`,
    body: () => ({ confirmed_type: 'server', authorization_status: 'authorized' }),
  },
  {
    name: 'unidentify',
    method: 'PATCH',
    path: f => `/v1/assets/${f.asset}/unidentify`,
    body: () => ({}),
  },
  {
    name: 'rename report',
    method: 'PATCH',
    path: f => `/v1/scan-reports/${f.report}/name`,
    body: () => ({ display_name: 'Informe actualizado' }),
  },
  {
    name: 'rename snapshot',
    method: 'PATCH',
    path: f => `/v1/inventory-snapshots/${f.snapshot}/name`,
    body: () => ({ display_name: 'Instantánea actualizada' }),
  },
  {
    name: 'create office',
    method: 'POST',
    path: () => '/v1/offices',
    body: () => ({ name: 'Nueva oficina', province_id: '82' }),
    managerDenied: true,
  },
  {
    name: 'edit office',
    method: 'PATCH',
    path: f => `/v1/offices/${f.office}`,
    body: () => ({ name: 'Nombre actualizado', province_id: '82' }),
    managerDenied: true,
  },
  {
    name: 'reactivate office',
    method: 'POST',
    path: f => `/v1/offices/${f.office}/status`,
    body: () => ({ is_active: true }),
    managerDenied: true,
  },
  {
    name: 'create member',
    method: 'POST',
    path: () => '/v1/org-members',
    body: f => ({
      name: 'Persona de prueba',
      email: `permission-${randomUUID()}@example.test`,
      password,
      role: 'org_viewer',
      office_ids: [f.office],
    }),
  },
  {
    name: 'edit member',
    method: 'PATCH',
    path: f => `/v1/org-members/${f.viewer}`,
    body: f => ({ office_ids: [f.office] }),
  },
  {
    name: 'inventory settings',
    method: 'PATCH',
    path: () => '/v1/organization-settings',
    body: () => settings,
    managerDenied: true,
  },
  {
    name: 'maturity',
    method: 'PATCH',
    path: () => '/v1/organization-settings/maturity',
    body: () => ({ maturity_it_owner: 'yes', maturity_security_budget: 'recurring' }),
    managerDenied: true,
  },
  {
    name: 'generate snapshot',
    method: 'POST',
    path: () => '/v1/inventory-snapshots/generate',
    body: f => ({ office_id: f.office }),
    managerDenied: true,
  },
  {
    name: 'provision scanner',
    method: 'POST',
    path: () => '/v1/agents/provision',
    body: f => ({ office_id: f.office }),
  },
  {
    name: 'revoke scanner',
    method: 'POST',
    path: f => `/v1/agents/${f.agent}/revoke`,
    body: () => ({}),
  },
  {
    name: 'draft office review',
    method: 'PATCH',
    path: f => `/v1/assessments/${f.assessment}/draft`,
    body: () => ({ answers: [] }),
    staffStatus: 403,
  },
  {
    name: 'create task',
    method: 'POST',
    path: () => '/v1/tasks',
    body: f => ({
      title: 'Nueva tarea',
      priority: 'normal',
      global: false,
      office_ids: [f.office],
      assignment_kind: 'open_pool',
    }),
    staffStatus: 400,
  },
  {
    name: 'edit task',
    method: 'PATCH',
    path: f => `/v1/tasks/${f.task}`,
    body: () => ({ title: 'Título actualizado' }),
    staffStatus: 400,
  },
  {
    name: 'reassign task',
    method: 'POST',
    path: f => `/v1/tasks/${f.task}/reassign`,
    body: () => ({ assignment_kind: 'open_pool' }),
    staffStatus: 400,
  },
  {
    name: 'cancel task',
    method: 'POST',
    path: f => `/v1/tasks/${f.task}/cancel`,
    body: () => ({ reason: 'Cancelar por prueba' }),
    staffStatus: 400,
  },
  {
    name: 'force complete task',
    method: 'POST',
    path: f => `/v1/tasks/${f.task}/force-complete`,
    body: () => ({ reason: 'Finalizar por prueba' }),
    staffStatus: 400,
  },
  {
    name: 'delete task',
    method: 'DELETE',
    path: f => `/v1/tasks/${f.task}`,
    body: () => undefined,
    staffStatus: 400,
  },
]

beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_permissions_[a-z0-9]+$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use a fresh disposable siam_permissions_* database on port 55443')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  expect(
    (await payload.count({ collection: 'organizations', overrideAccess: true })).totalDocs
  ).toBe(0)
  const role = await payload.create({
    collection: 'roles',
    overrideAccess: true,
    data: {
      slug: 'platform_admin',
      name: 'Administrador de plataforma',
      rank: 0,
      scope: 'platform',
      is_platform_role: true,
    },
  })
  const admin = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      role: role.id,
      name: 'Personal de plataforma',
      email: 'platform@permissions.test',
      password,
      status: 'active',
    },
  })
  platform = await login(String(admin.id), 'admins')
  own = await makeFixture('Propio')
  foreign = await makeFixture('Ajeno')
  inactive = await makeFixture('Inactivo')
  expect(
    (
      await api(`/v1/platform-admin/organizations/${inactive.org}/status`, platform, 'POST', {
        is_active: false,
        confirm_name: inactive.name,
      })
    ).status
  ).toBe(200)
}, 60000)
afterAll(async () => {
  // Printed only for test evidence; includes no cookie, password or credential.
  console.info('PERMISSION_ROUTE_CHECKS', JSON.stringify(routeChecks))
  if (payload) await payload.destroy()
})

it('every registered human custom endpoint rejects anonymous requests without writes', async () => {
  const machine = new Set([
    '/v1/reports',
    '/v1/heartbeat',
    '/v1/vendor',
    '/v1/internal/jobs/expire-scan-payloads',
    '/v1/internal/jobs/aging-sweep',
  ])
  const before = await versions()
  const routes = (config.endpoints || []).filter(
    endpoint => endpoint.path.startsWith('/v1/') && !machine.has(endpoint.path)
  )
  expect(routes.length).toBeGreaterThan(50)
  for (const route of routes) {
    const method = route.method.toUpperCase(),
      path = route.path.replaceAll(':id', missingId)
    const result = await api(
      path,
      '',
      method,
      method === 'GET' || method === 'DELETE' ? undefined : {}
    )
    routeChecks.push({ actor: 'anonymous', method, path: route.path, status: result.status })
    expect.soft(result.status, `${method} ${route.path}: ${JSON.stringify(result.data)}`).toBe(401)
  }
  expect(await versions()).toEqual(before)
}, 60000)

for (const write of writes) {
  it(`viewer cannot ${write.name}, with no persisted changes`, async () => {
    const before = await versions()
    const result = await api(write.path(own), own.viewerCookie, write.method, write.body(own))
    expect(result.status, JSON.stringify(result.data)).toBe(403)
    expect(await versions()).toEqual(before)
  })
  it(`StaffPortal cannot ${write.name} without an organization context`, async () => {
    const before = await versions()
    const result = await api(write.path(own), platform, write.method, write.body(own))
    expect(result.status, JSON.stringify(result.data)).toBe(write.staffStatus ?? 403)
    expect(await versions()).toEqual(before)
  })
  if (write.managerDenied)
    it(`manager cannot ${write.name}`, async () => {
      const before = await versions()
      expect(
        (await api(write.path(own), own.managerCookie, write.method, write.body(own))).status
      ).toBe(403)
      expect(await versions()).toEqual(before)
    })
}

for (const role of ['admin', 'manager', 'viewer'] as const) {
  it(`${role}: asOrganization cannot switch a member into another tenant`, async () => {
    const cookie = own[`${role}Cookie`]
    const result = await api(`/v1/session?asOrganization=${foreign.org}`, cookie)
    expect(result.status).toBe(200)
    expect(result.data.organizationId).toBe(own.org)
    expect(result.data.userId).toBe(own[role])
    expect(JSON.stringify(result.data)).not.toContain(foreign.office)
  })
}

const objectReads = [
  { name: 'asset', path: (f: Fixture) => `/assets/${f.asset}` },
  { name: 'snapshot', path: (f: Fixture) => `/inventory-snapshots/${f.snapshot}` },
  { name: 'report', path: (f: Fixture) => `/scan-reports/${f.report}` },
  { name: 'task', path: (f: Fixture) => `/v1/tasks/${f.task}` },
  { name: 'review', path: (f: Fixture) => `/v1/assessments/${f.assessment}` },
]
for (const resource of objectReads) {
  for (const role of ['admin', 'manager', 'viewer'] as const) {
    it(`${role} reads own ${resource.name}, never a foreign one`, async () => {
      const cookie = own[`${role}Cookie`]
      expect((await api(resource.path(own), cookie)).status).toBe(200)
      const result = await api(resource.path(foreign), cookie)
      expect(result.status, JSON.stringify(result.data)).toBe(
        resource.name === 'review' ? 403 : 404
      )
      expect(JSON.stringify(result.data)).not.toContain(foreign.label)
      expect(JSON.stringify(result.data)).not.toContain(foreign.org)
    })
  }
}

for (const resource of ['asset', 'snapshot', 'report'] as const) {
  it(`manager cannot rename/update a foreign ${resource}, despite having the action`, async () => {
    const write = writes.find(
      w =>
        w.name ===
        { asset: 'asset business', snapshot: 'rename snapshot', report: 'rename report' }[resource]
    )!
    const before = await versions()
    const result = await api(
      write.path(foreign),
      own.managerCookie,
      write.method,
      write.body(foreign)
    )
    expect(result.status, JSON.stringify(result.data)).toBe(403)
    expect(await versions()).toEqual(before)
  })
}

it('PlatformAdmin visit derives target offices and tenant permissions without changing identity', async () => {
  const staff = await api('/v1/session', platform)
  expect(staff.data).toMatchObject({
    organizationId: null,
    role: 'platform_admin',
    isPlatformAdmin: true,
  })
  for (const f of [own, foreign]) {
    const result = await api(`/v1/session?asOrganization=${f.org}`, platform)
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      userId: staff.data.userId,
      organizationId: f.org,
      role: 'org_admin',
      isPlatformAdmin: true,
    })
    expect(result.data.officeIds.sort()).toEqual([f.office, f.second].sort())
    expect(result.data.permissions.tasks).toContain('edit')
  }
})

it('a visited context cannot edit an asset of a different organization', async () => {
  const before = await versions()
  const result = await api(
    `/v1/assets/${foreign.asset}/business?asOrganization=${own.org}`,
    platform,
    'PATCH',
    { alias: 'Fuera de alcance' }
  )
  expect(result.status).toBe(403)
  expect(await versions()).toEqual(before)
})

for (const action of ['GET', 'PATCH'] as const) {
  it(`platform profile ${action} is unavailable to organization members`, async () => {
    const before = await versions()
    const result = await api(
      '/v1/platform-admin-profile',
      own.adminCookie,
      action,
      action === 'PATCH' ? { name: 'No permitido' } : undefined
    )
    expect(result.status).toBe(403)
    expect(await versions()).toEqual(before)
  })
}

it('the same cookie reflects role changes and loss of assigned-office access immediately', async () => {
  const id = await member(payload, own.org, [own.office], 'office_manager'),
    cookie = await login(id)
  expect(
    (await api(`/v1/assets/${own.asset}/business`, cookie, 'PATCH', { alias: 'Cambio permitido' }))
      .status
  ).toBe(200)
  expect(
    (await api(`/v1/org-members/${id}`, own.adminCookie, 'PATCH', { role: 'org_viewer' })).status
  ).toBe(200)
  const session = await api('/v1/session', cookie)
  expect(session.data.role).toBe('org_viewer')
  expect(session.data.permissions.assets).not.toContain('update')
  const before = await versions()
  expect(
    (await api(`/v1/assets/${own.asset}/business`, cookie, 'PATCH', { alias: 'Intento rechazado' }))
      .status
  ).toBe(403)
  expect(await versions()).toEqual(before)
  expect(
    (await api(`/v1/org-members/${id}`, own.adminCookie, 'PATCH', { office_ids: [own.second] }))
      .status
  ).toBe(200)
  expect((await api('/v1/session', cookie)).data.officeIds).toEqual([own.second])
  expect((await api(`/assets/${own.asset}`, cookie)).status).toBe(404)
})

for (const actor of ['admin', 'manager', 'viewer', 'visited-platform'] as const) {
  it(`${actor}: platform management routes are forbidden, without changing data`, async () => {
    const before = await versions()
    const cookie = actor === 'visited-platform' ? platform : own[`${actor}Cookie`]
    const routes = (config.endpoints || []).filter(endpoint =>
      endpoint.path.startsWith('/v1/platform-admin/')
    )
    expect(routes.length).toBeGreaterThan(10)
    for (const route of routes) {
      const method = route.method.toUpperCase()
      const path =
        route.path.replaceAll(':id', own.org) +
        (actor === 'visited-platform' ? `?asOrganization=${own.org}` : '')
      const result = await api(
        path,
        cookie,
        method,
        method === 'GET' || method === 'DELETE' ? undefined : {}
      )
      routeChecks.push({ actor, method, path: route.path, status: result.status })
      expect.soft(result.status, `${actor} ${method} ${route.path}`).toBe(403)
    }
    expect(await versions()).toEqual(before)
  }, 30000)
}

for (const actor of ['admin', 'manager', 'viewer', 'platform', 'visited-platform'] as const) {
  it(`${actor}: settings access matches the effective role`, async () => {
    const cookie =
      actor === 'platform' || actor === 'visited-platform' ? platform : own[`${actor}Cookie`]
    const path =
      '/v1/organization-settings' +
      (actor === 'visited-platform' ? `?asOrganization=${own.org}` : '')
    const result = await api(path, cookie)
    expect(result.status).toBe(actor === 'admin' || actor === 'visited-platform' ? 200 : 403)
    if (result.status === 200) expect(result.data.organization).toBe(own.org)
  })
}

it('active tenant writes have successful controls with the same valid inputs', async () => {
  const beforeForeign = await payload.findByID({
    collection: 'organizations',
    id: foreign.org,
    overrideAccess: true,
    depth: 0,
  })
  for (const name of [
    'asset business',
    'edit office',
    'rename report',
    'rename snapshot',
    'inventory settings',
    'maturity',
    'draft office review',
    'edit task',
  ]) {
    const write = writes.find(w => w.name === name)!
    const result = await api(write.path(own), own.adminCookie, write.method, write.body(own))
    expect(result.status, `${name}: ${result.data.error ?? result.status}`).toBe(200)
  }
  expect(
    await payload.findByID({ collection: 'assets', id: own.asset, overrideAccess: true, depth: 0 })
  ).toMatchObject({ alias: 'Edición de prueba' })
  expect(
    await payload.findByID({ collection: 'tasks', id: own.task, overrideAccess: true, depth: 0 })
  ).toMatchObject({ title: 'Título actualizado' })
  expect(
    await payload.findByID({
      collection: 'scan-reports',
      id: own.report,
      overrideAccess: true,
      depth: 0,
    })
  ).toMatchObject({ display_name: 'Informe actualizado' })
  expect(
    await payload.findByID({
      collection: 'organizations',
      id: foreign.org,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(beforeForeign)
})

it('office-scoped readers cannot open a task of another office in their own organization', async () => {
  const created = await api('/v1/tasks', own.adminCookie, 'POST', {
    title: 'Tarea de otra oficina',
    priority: 'normal',
    global: false,
    office_ids: [own.second],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const path = `/v1/tasks/${created.data.docs[0].id}`
  expect((await api(path, own.adminCookie)).status).toBe(200)
  for (const cookie of [own.managerCookie, own.viewerCookie]) {
    const result = await api(path, cookie)
    expect(result.status).toBe(404)
    expect(JSON.stringify(result.data)).not.toContain('Tarea de otra oficina')
  }
})

it('visiting an active organization still allows all eight affected writes', async () => {
  for (const name of [
    'identify',
    'asset business',
    'rename report',
    'rename snapshot',
    'edit office',
    'inventory settings',
    'maturity',
    'unidentify',
  ]) {
    const write = writes.find(w => w.name === name)!
    const result = await api(
      `${write.path(own)}?asOrganization=${own.org}`,
      platform,
      write.method,
      write.body(own)
    )
    expect(result.status, name).toBe(200)
  }
  // Keep the shared active fixture identified for the response-privacy controls below.
  expect(
    (
      await api(`/v1/assets/${own.asset}/identify?asOrganization=${own.org}`, platform, 'PATCH', {
        confirmed_type: 'server',
        authorization_status: 'authorized',
      })
    ).status
  ).toBe(200)
})

it('an inactive visit retains historical reads without changing the tenant or account status', async () => {
  const cookie = platform
  const before = await versions()
  const suffix = `?asOrganization=${inactive.org}`
  const session = await api(`/v1/session${suffix}`, cookie)
  expect(session.status).toBe(200)
  expect(session.data).toMatchObject({
    organizationId: inactive.org,
    isPlatformAdmin: true,
    isActive: true,
  })
  for (const path of [
    `/assets/${inactive.asset}`,
    `/scan-reports/${inactive.report}`,
    `/inventory-snapshots/${inactive.snapshot}`,
    `/offices/${inactive.office}`,
    '/v1/organization-settings',
  ]) {
    expect((await api(`${path}${suffix}`, cookie)).status, path).toBe(200)
  }
  expect(await versions()).toEqual(before)
})

it('authorized network asset mutation responses do not expose scanner credential hashes', async () => {
  const credentialFields = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, child]) =>
      key === 'apiKeyHash' || key === 'apiKey' ? [key] : credentialFields(child)
    )
  }
  for (const name of ['asset business', 'identify', 'unidentify']) {
    const write = writes.find(w => w.name === name)!
    const result = await api(write.path(own), own.adminCookie, write.method, write.body(own))
    expect(result.status, name).toBe(200)
    // Report field names only. Never include fixture tokens/hashes in failure output.
    expect
      .soft(credentialFields(result.data), `${name} response contains private credential fields`)
      .toEqual([])
  }
})

it('a deactivated member cannot reuse the old cookie to read or write', async () => {
  const id = await member(payload, own.org, [own.office], 'org_viewer'),
    cookie = await login(id)
  const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
  expect(
    (
      await api(`/v1/org-members/${id}`, own.adminCookie, 'PATCH', {
        is_active: false,
        confirm_email: user.email,
      })
    ).status
  ).toBe(200)
  const before = await versions()
  expect((await api('/v1/session', cookie)).status).toBe(401)
  expect((await api(`/v1/tasks/${own.task}`, cookie)).status).toBe(401)
  expect(
    (await api('/v1/tasks', cookie, 'POST', writes.find(w => w.name === 'create task')!.body(own)))
      .status
  ).toBe(401)
  expect(await versions()).toEqual(before)
})

for (const write of writes) {
  it(`organization deactivation revokes old member cookie for ${write.name}`, async () => {
    const before = await versions()
    const result = await api(
      write.path(inactive),
      inactive.adminCookie,
      write.method,
      write.body(inactive)
    )
    expect(result.status, JSON.stringify(result.data)).toBe(401)
    expect(await versions()).toEqual(before)
  })
  it(`visiting an inactive organization cannot ${write.name}`, async () => {
    const before = await versions()
    const path = `${write.path(inactive)}?asOrganization=${inactive.org}`
    const result = await api(path, platform, write.method, write.body(inactive))
    const after = await versions()
    const changed = tracked.filter(
      collection => JSON.stringify(before[collection]) !== JSON.stringify(after[collection])
    )
    routeChecks.push({
      actor: 'inactive-visit',
      method: write.method,
      path: write.path(inactive),
      status: result.status,
    })
    // Revoking an already revoked scanner is a successful no-op by contract.
    if (write.name === 'revoke scanner' && result.status === 200) {
      expect(result.data.lifecycle_status).toBe('revoked')
      expect(after).toEqual(before)
      return
    }
    // A task office that the lifecycle has deactivated is a business validation failure.
    if (write.name === 'create task' && result.status === 400) {
      expect(result.data.error).toBe('invalid_offices')
      expect(after).toEqual(before)
      return
    }
    expect
      .soft(
        [401, 403, 404, 409],
        `${write.name}: status=${result.status}, changed=${changed.join(',')}`
      )
      .toContain(result.status)
    expect(changed, `${write.name} must not persist changes in an inactive organization`).toEqual(
      []
    )
  })
}

it('StaffPortal can reactivate the organization and its visited writes become available again', async () => {
  expect(
    (
      await api(`/v1/platform-admin/organizations/${inactive.org}/status`, platform, 'POST', {
        is_active: true,
      })
    ).status
  ).toBe(200)
  const suffix = `?asOrganization=${inactive.org}`
  const saved = await api(`/v1/organization-settings${suffix}`, platform, 'PATCH', settings)
  expect(saved.status).toBe(200)
  expect(saved.data.offline_after_hours).toBe(24)
  const asset = await api(`/v1/assets/${inactive.asset}/identify${suffix}`, platform, 'PATCH', {
    confirmed_type: 'server',
    authorization_status: 'authorized',
  })
  expect(asset.status).toBe(200)
  expect(asset.data.identification_status).toBe('confirmed')
})
