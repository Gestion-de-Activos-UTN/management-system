import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  createLocalReq,
  getPayload,
  handleEndpoints,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import { relationId } from '@/lib/relationId'
import { getTenantContext } from '@/access/tenant/resolveTenantContext'
import { updateMember } from '@/domain/organizations/member-admin'
import { withTransaction } from '@/domain/with-transaction'
import { organizationAdminLock } from '@/domain/organizations/admin-actions'

let payload: Payload, config: SanitizedConfig
let org: string,
  office: string,
  otherOffice: string,
  manager: string,
  managerCookie: string,
  adminCookie: string
let admin: string,
  local: string,
  localEmail: string,
  mixed: string,
  outside: string,
  foreign: string
let inactiveLocal: string, inactiveMixed: string, localCookie: string
const endpoint = (id: string) => `/api/v1/org-members/${id}`
async function api(path: string, method = 'GET', body?: unknown, cookie = managerCookie) {
  const response = await handleEndpoints({
    config,
    request: new Request('http://localhost' + path, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  })
  return { status: response.status, data: await response.json(), response }
}
async function login(id: string) {
  const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
  const result = await api(
    '/api/users/login',
    'POST',
    { email: user.email, password: 'x'.repeat(12) },
    ''
  )
  expect(result.status).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}
async function membership(id: string) {
  return (
    await payload.find({
      collection: 'organization-memberships',
      where: { user: { equals: id } },
      overrideAccess: true,
      depth: 0,
      limit: 1,
    })
  ).docs[0]
}
async function deactivateFixture(id: string) {
  const row = await membership(id)
  await payload.update({
    collection: 'organization-memberships',
    id: row.id,
    overrideAccess: true,
    data: { is_active: false },
  })
}
beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_test@127\.0\.0\.1:55447\/siam_member_status_[a-z0-9]+$/.test(
      process.env.DATABASE_URL ?? ''
    ) &&
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_audit_security(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use an isolated disposable siam_member_status_* database on port 55447')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const fixture = await seedRiskOrganization(payload)
  org = String(fixture.organization.id)
  office = String(fixture.office.id)
  otherOffice = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { name: 'Otra oficina', organization: org },
      })
    ).id
  )
  admin = await member(payload, org, [office, otherOffice], 'org_admin')
  manager = await member(payload, org, [office], 'office_manager')
  local = await member(payload, org, [office], 'org_viewer')
  mixed = await member(payload, org, [office, otherOffice], 'org_viewer')
  outside = await member(payload, org, [otherOffice], 'org_viewer')
  inactiveLocal = await member(payload, org, [office], 'org_viewer')
  inactiveMixed = await member(payload, org, [office, otherOffice], 'org_viewer')
  const other = await seedRiskOrganization(payload)
  foreign = await member(
    payload,
    String(other.organization.id),
    [String(other.office.id)],
    'org_viewer'
  )
  localEmail = (await payload.findByID({ collection: 'users', id: local, overrideAccess: true }))
    .email
  await deactivateFixture(inactiveLocal)
  await deactivateFixture(inactiveMixed)
  managerCookie = await login(manager)
  adminCookie = await login(admin)
  localCookie = await login(local)
}, 60000)
afterAll(async () => {
  if (payload) await payload.destroy()
})

it('rechecks delegated office scope inside the transaction instead of trusting an old request context', async () => {
  const user = await payload.findByID({ collection: 'users', id: manager, overrideAccess: true })
  const req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  const ctx = await getTenantContext(req)
  if (!ctx) throw new Error('Manager context required')
  const stale = { ...ctx, organizationId: org, officeIds: [office, otherOffice] }
  const before = await membership(mixed)
  await expect(
    withTransaction(payload, req, () => updateMember(req, stale, mixed, { office_ids: [office] }), {
      lockKey: organizationAdminLock(org),
    })
  ).rejects.toMatchObject({ status: 403 })
  expect((await membership(mixed)).offices).toEqual(before.offices)
})

it('exposes status permission separately from editing access and lists only manageable inactive Viewers', async () => {
  const session = await api('/api/v1/session')
  expect(session.data.permissions.organizationMembers).toMatchObject({
    create: true,
    update: false,
    changeStatus: true,
    editOffices: true,
  })
  const list = await api('/api/v1/org-members?include_inactive=1')
  expect(list.status).toBe(200)
  const docs = list.data.docs as Array<{
    id: string
    can_change_status: boolean
    can_edit_offices: boolean
  }>
  expect(docs.find(row => row.id === local)?.can_change_status).toBe(true)
  expect(docs.find(row => row.id === local)?.can_edit_offices).toBe(true)
  expect(docs.find(row => row.id === mixed)?.can_edit_offices).toBe(false)
  expect(docs.find(row => row.id === inactiveLocal)?.can_edit_offices).toBe(false)
  expect(docs.find(row => row.id === mixed)?.can_change_status).toBe(false)
  expect(docs.find(row => row.id === manager)?.can_change_status).toBe(false)
  expect(docs.some(row => row.id === inactiveLocal)).toBe(true)
  expect(
    docs.some(row => row.id === inactiveMixed || row.id === foreign || row.id === outside)
  ).toBe(false)
})

it('edits only active Viewers within scope, keeps their role, and releases only removed-office responsibilities', async () => {
  expect((await api(endpoint(inactiveLocal), 'PATCH', { office_ids: [office] })).status).toBe(403)
  expect((await api(endpoint(local), 'PATCH', { office_ids: [] })).status).toBe(400)
  expect((await membership(local)).offices?.map(relationId)).toEqual([office])
  const third = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { name: 'Tercera oficina', organization: org },
      })
    ).id
  )
  const managerMembership = await membership(manager)
  await payload.update({
    collection: 'organization-memberships',
    id: managerMembership.id,
    overrideAccess: true,
    data: { offices: [office, third] },
  })
  try {
    expect((await api(endpoint(local), 'PATCH', { office_ids: [office, third] })).status).toBe(200)
    const updated = await membership(local)
    expect(new Set(updated.offices?.map(relationId))).toEqual(new Set([office, third]))
    expect(
      (
        await payload.findByID({
          collection: 'roles',
          id: relationId(updated.role),
          overrideAccess: true,
        })
      ).slug
    ).toBe('org_viewer')
    const cookie = await login(local)
    const assets = []
    const tasks = []
    for (const officeId of [office, third]) {
      assets.push(
        await payload.create({
          collection: 'non-network-assets',
          overrideAccess: true,
          data: {
            organization: org,
            office: officeId,
            owner: local,
            alias: 'Equipo por oficina',
            asset_category: 'computer',
            criticality: 'medium',
            status: 'active',
            review_interval: 'never',
          },
        })
      )
      const task = await api('/api/v1/tasks', 'POST', {
        title: 'Revisar la oficina',
        priority: 'normal',
        global: false,
        office_ids: [officeId],
        assignment_kind: 'open_pool',
      })
      expect(task.status).toBe(201)
      tasks.push(task.data.docs[0].id as string)
      expect((await api(`/api/v1/tasks/${tasks.at(-1)}/claim`, 'POST', {}, cookie)).status).toBe(
        200
      )
    }
    expect((await api(endpoint(local), 'PATCH', { office_ids: [office] }, cookie)).status).toBe(403)
    expect((await api(endpoint(local), 'PATCH', { office_ids: [office] })).status).toBe(200)
    expect(
      relationId(
        (
          await payload.findByID({
            collection: 'non-network-assets',
            id: assets[0].id,
            depth: 0,
            overrideAccess: true,
          })
        ).owner
      )
    ).toBe(local)
    expect(
      (
        await payload.findByID({
          collection: 'non-network-assets',
          id: assets[1].id,
          depth: 0,
          overrideAccess: true,
        })
      ).owner
    ).toBeNull()
    expect(
      (
        await payload.findByID({
          collection: 'tasks',
          id: tasks[0],
          depth: 0,
          overrideAccess: true,
        })
      ).status
    ).toBe('in_progress')
    const released = await payload.findByID({
      collection: 'tasks',
      id: tasks[1],
      depth: 0,
      overrideAccess: true,
    })
    expect(released.status).toBe('pending')
    expect(released.claimed_by ?? null).toBeNull()
    expect((await api('/api/v1/session', 'GET', undefined, cookie)).data.officeIds).toEqual([
      office,
    ])
    expect([403, 404]).toContain(
      (await api(`/api/v1/tasks/${tasks[1]}`, 'GET', undefined, cookie)).status
    )
    expect((await api(`/api/v1/tasks/${tasks[0]}/complete`, 'POST', {}, cookie)).status).toBe(200)
  } finally {
    await payload.update({
      collection: 'organization-memberships',
      id: managerMembership.id,
      overrideAccess: true,
      data: { offices: [office] },
    })
  }
})

it('rejects preview and changes for administrators, managers, mixed scope and foreign offices or tenants', async () => {
  for (const id of [admin, manager, mixed, outside, foreign, inactiveMixed]) {
    const before = await membership(id)
    const preview = await api(`${endpoint(id)}/deactivation-impact`)
    expect([403, 404]).toContain(preview.status)
    expect(preview.data.owned_assets).toBeUndefined()
    const email = (await payload.findByID({ collection: 'users', id, overrideAccess: true })).email
    const result = await api(endpoint(id), 'PATCH', { is_active: false, confirm_email: email })
    expect([403, 404]).toContain(result.status)
    expect((await membership(id)).is_active).toBe(before.is_active)
    expect([403, 404]).toContain((await api(endpoint(id), 'PATCH', { is_active: true })).status)
    expect([403, 404]).toContain(
      (await api(endpoint(id), 'PATCH', { office_ids: [office] })).status
    )
  }
})

it('preserves delegated creation of Viewers without granting creation of other roles', async () => {
  const credentials = {
    name: 'Nueva persona',
    email: 'new-viewer@delegated.test',
    password: 'x'.repeat(12),
  }
  expect(
    (
      await api('/api/v1/org-members', 'POST', {
        ...credentials,
        role: 'org_admin',
        office_ids: [],
      })
    ).status
  ).toBe(403)
  expect(
    (
      await api('/api/v1/org-members', 'POST', {
        ...credentials,
        role: 'org_viewer',
        office_ids: [office],
      })
    ).status
  ).toBe(201)
})

it('rejects role edits and office reassignment even if accompanied by a status flag', async () => {
  for (const body of [
    { role: 'org_admin' },
    { role: 'org_viewer', is_active: true },
    { office_ids: [otherOffice] },
    { is_active: true, office_ids: [otherOffice] },
  ])
    expect((await api(endpoint(local), 'PATCH', body)).status).toBe(403)
  const row = await membership(local)
  expect(row.offices?.map(relationId)).toEqual([office])
  const role = await payload.findByID({
    collection: 'roles',
    id: relationId(row.role),
    overrideAccess: true,
  })
  expect(role.slug).toBe('org_viewer')
})

it('requires the matching email, applies deactivation impacts, revokes access and reactivates without restoring ownership', async () => {
  const asset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      organization: org,
      office,
      owner: local,
      alias: 'Equipo del Viewer',
      asset_category: 'computer',
      criticality: 'medium',
      status: 'active',
      review_interval: 'never',
    },
  })
  const createdTask = await api('/api/v1/tasks', 'POST', {
    title: 'Tarea del Viewer',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'open_pool',
  })
  expect(createdTask.status).toBe(201)
  const taskId = createdTask.data.docs[0].id
  expect((await api(`/api/v1/tasks/${taskId}/claim`, 'POST', {}, localCookie)).status).toBe(200)
  const preview = await api(`${endpoint(local)}/deactivation-impact`)
  expect(preview.status).toBe(200)
  expect(preview.data.owned_assets.some((row: { id: string }) => row.id === asset.id)).toBe(true)
  expect(preview.data.in_progress_tasks).toBe(1)
  expect((await api(endpoint(local), 'PATCH', { is_active: false })).status).toBe(400)
  expect(
    (await api(endpoint(local), 'PATCH', { is_active: false, confirm_email: 'wrong@example.test' }))
      .status
  ).toBe(400)
  expect((await membership(local)).is_active).toBe(true)
  expect(
    (await api(endpoint(local), 'PATCH', { is_active: false, confirm_email: localEmail })).status
  ).toBe(200)
  expect((await membership(local)).is_active).toBe(false)
  const released = await payload.findByID({
    collection: 'tasks',
    id: taskId,
    depth: 0,
    overrideAccess: true,
  })
  expect(released.status).toBe('pending')
  expect(released.claimed_by ?? null).toBeNull()
  expect((await api('/api/v1/session', 'GET', undefined, localCookie)).status).toBe(401)
  expect(
    (
      await payload.findByID({
        collection: 'non-network-assets',
        id: asset.id,
        depth: 0,
        overrideAccess: true,
      })
    ).owner
  ).toBeNull()
  expect((await api(endpoint(local), 'PATCH', { is_active: true })).status).toBe(200)
  expect((await membership(local)).is_active).toBe(true)
  expect(
    (await payload.findByID({ collection: 'users', id: local, overrideAccess: true })).status
  ).toBe('active')
  expect(
    (
      await payload.findByID({
        collection: 'non-network-assets',
        id: asset.id,
        depth: 0,
        overrideAccess: true,
      })
    ).owner
  ).toBeNull()
  expect((await api('/api/v1/session', 'GET', undefined, localCookie)).status).toBe(401)
  expect(await login(local)).toBeTruthy()
})

it('allows an eligible replacement when deactivating a fully covered Viewer', async () => {
  const id = await member(payload, org, [office], 'org_viewer')
  const email = (await payload.findByID({ collection: 'users', id, overrideAccess: true })).email
  const asset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      organization: org,
      office,
      owner: id,
      alias: 'Equipo para reasignar',
      asset_category: 'computer',
      criticality: 'medium',
      status: 'active',
      review_interval: 'never',
    },
  })
  expect(
    (
      await api(endpoint(id), 'PATCH', {
        is_active: false,
        confirm_email: email,
        replacement_owner_id: manager,
      })
    ).status
  ).toBe(200)
  expect(
    relationId(
      (
        await payload.findByID({
          collection: 'non-network-assets',
          id: asset.id,
          depth: 0,
          overrideAccess: true,
        })
      ).owner
    )
  ).toBe(manager)
})

it('applies plan limits and rejects a reactivation with an outside-office override', async () => {
  expect(
    (await api(endpoint(inactiveLocal), 'PATCH', { is_active: true, office_ids: [otherOffice] }))
      .status
  ).toBe(403)
  const subscription = (
    await payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: org } },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    overrideAccess: true,
    data: { user_limits: { org_viewer: 0 } },
  })
  try {
    const result = await api(endpoint(inactiveLocal), 'PATCH', { is_active: true })
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('user_limit_reached')
    expect((await membership(inactiveLocal)).is_active).toBe(false)
  } finally {
    await payload.update({
      collection: 'subscriptions',
      id: subscription.id,
      overrideAccess: true,
      data: { user_limits: subscription.user_limits },
    })
  }
})

it('lets OrgAdmin change an inactive member role and offices even when the old role is full, without activating or consuming quota', async () => {
  const target = await member(payload, org, [office], 'office_manager')
  await deactivateFixture(target)
  const subscription = (
    await payload.find({
      collection: 'subscriptions',
      where: { organization: { equals: org } },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  const viewerRole = (
    await payload.find({
      collection: 'roles',
      where: { slug: { equals: 'org_viewer' } },
      overrideAccess: true,
      limit: 1,
    })
  ).docs[0]
  const countViewers = () =>
    payload.count({
      collection: 'organization-memberships',
      where: {
        and: [
          { organization: { equals: org } },
          { role: { equals: viewerRole.id } },
          { is_active: { equals: true } },
        ],
      },
      overrideAccess: true,
    })
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    overrideAccess: true,
    data: { user_limits: { office_manager: 1, org_viewer: 0 } },
  })
  try {
    expect((await api(endpoint(target), 'PATCH', { is_active: true }, adminCookie)).status).toBe(
      409
    )
    const before = await membership(target)
    expect(
      (
        await api(
          endpoint(target),
          'PATCH',
          { role: 'office_manager', office_ids: [] },
          adminCookie
        )
      ).status
    ).toBe(400)
    expect((await membership(target)).offices).toEqual(before.offices)
    expect(
      (
        await api(
          endpoint(target),
          'PATCH',
          { role: 'office_manager', office_ids: [otherOffice] },
          adminCookie
        )
      ).status
    ).toBe(200)
    expect((await membership(target)).offices?.map(relationId)).toEqual([otherOffice])
    const used = (await countViewers()).totalDocs
    expect(
      (
        await api(
          endpoint(target),
          'PATCH',
          { role: 'org_viewer', office_ids: [otherOffice] },
          adminCookie
        )
      ).status
    ).toBe(200)
    expect(await membership(target)).toMatchObject({ is_active: false, role: viewerRole.id })
    expect(
      (await payload.findByID({ collection: 'users', id: target, overrideAccess: true })).status
    ).toBe('inactive')
    expect((await countViewers()).totalDocs).toBe(used)
    const limited = await api(endpoint(target), 'PATCH', { is_active: true }, adminCookie)
    expect(limited.status).toBe(409)
    expect(limited.data.error).toBe('user_limit_reached')
    expect((await membership(target)).is_active).toBe(false)
    await payload.update({
      collection: 'subscriptions',
      id: subscription.id,
      overrideAccess: true,
      data: { user_limits: { office_manager: 1, org_viewer: 20 } },
    })
    expect((await api(endpoint(target), 'PATCH', { is_active: true }, adminCookie)).status).toBe(
      200
    )
    expect(await membership(target)).toMatchObject({ is_active: true, role: viewerRole.id })
    expect((await membership(target)).offices?.map(relationId)).toEqual([otherOffice])
  } finally {
    await payload.update({
      collection: 'subscriptions',
      id: subscription.id,
      overrideAccess: true,
      data: { user_limits: subscription.user_limits },
    })
  }
  const protectedAdmin = await api(
    endpoint(admin),
    'PATCH',
    { role: 'org_viewer', office_ids: [office] },
    adminCookie
  )
  expect(protectedAdmin.status).toBe(409)
  expect(protectedAdmin.data.error).toBe('last_active_org_admin')
})

it('rejects editing inactive access in an inactive organization without changing membership', async () => {
  const before = await membership(inactiveLocal)
  await payload.update({
    collection: 'organizations',
    id: org,
    overrideAccess: true,
    data: { is_active: false },
  })
  try {
    const result = await api(
      endpoint(inactiveLocal),
      'PATCH',
      { role: 'office_manager', office_ids: [office] },
      adminCookie
    )
    expect(result.status).toBe(409)
    expect(result.data.error).toBe('organization_inactive')
    expect(await membership(inactiveLocal)).toMatchObject({
      is_active: false,
      role: before.role,
      offices: before.offices,
    })
  } finally {
    await payload.update({
      collection: 'organizations',
      id: org,
      overrideAccess: true,
      data: { is_active: true },
    })
  }
})
