import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getPayload, handleEndpoints, type Payload, type SanitizedConfig } from 'payload'
import { seedRiskOrganization, member } from '@/domain/risk/risk-integration-seed'

let payload: Payload, config: SanitizedConfig, org: string, adminCookie: string
const userCookies: string[] = []
const input = { name: 'Nombre actualizado', industry: 'other', industry_details: 'Actividad local' }
const path = () => `/api/v1/platform-admin/organizations/${org}`

async function api(url: string, method = 'GET', body?: unknown, cookie?: string) {
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost${url}`, {
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

async function login(email: string, collection: 'users' | 'admins') {
  const result = await api(`/api/${collection}/login`, 'POST', { email, password: 'x'.repeat(12) })
  expect(result.status).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}

beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_test@127\.0\.0\.1:55447\/siam_org_details_[a-z0-9]+$/.test(
      process.env.DATABASE_URL ?? ''
    ) &&
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_audit_security(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use an isolated disposable siam_org_details_* database on port 55447')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const fixture = await seedRiskOrganization(payload)
  org = String(fixture.organization.id)
  for (const role of ['org_admin', 'office_manager', 'org_viewer'] as const) {
    const id = await member(payload, org, [String(fixture.office.id)], role)
    const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
    userCookies.push(await login(user.email, 'users'))
  }
  const existingRoles = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'platform_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    existingRoles.docs[0] ??
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
  const admin = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      role: role.id,
      email: 'platform@org-details.test',
      password: 'x'.repeat(12),
      status: 'active',
    },
  })
  adminCookie = await login(admin.email, 'admins')
}, 60000)

afterAll(async () => {
  if (payload) await payload.destroy()
})

it('rejects anonymous and organization accounts for reads and edits', async () => {
  const before = await payload.findByID({
    collection: 'organizations',
    id: org,
    overrideAccess: true,
  })
  for (const cookie of [undefined, ...userCookies]) {
    const expected = cookie ? 403 : 401
    expect((await api(path(), 'GET', undefined, cookie)).status).toBe(expected)
    expect((await api(path(), 'PATCH', input, cookie)).status).toBe(expected)
  }
  expect(
    (await payload.findByID({ collection: 'organizations', id: org, overrideAccess: true })).name
  ).toBe(before.name)
})

it('rejects a PlatformAdmin in organization visit context', async () => {
  const scoped = `${path()}?asOrganization=${org}`
  expect((await api(scoped, 'GET', undefined, adminCookie)).status).toBe(403)
  expect((await api(scoped, 'PATCH', input, adminCookie)).status).toBe(403)
})

it('updates name and industry together and clears details when changing away from Other', async () => {
  expect((await api(path(), 'PATCH', input, adminCookie)).status).toBe(200)
  expect((await api(path(), 'GET', undefined, adminCookie)).data).toEqual(input)
  const next = { name: 'Otra denominación', industry: 'technology' }
  expect((await api(path(), 'PATCH', next, adminCookie)).status).toBe(200)
  expect((await api(path(), 'GET', undefined, adminCookie)).data).toEqual({
    ...next,
    industry_details: '',
  })
})

it('rejects invalid or unrelated fields without changing persisted data', async () => {
  const before = (await api(path(), 'GET', undefined, adminCookie)).data
  for (const body of [
    { ...input, name: '' },
    { ...input, industry: 'invalid' },
    { ...input, plan: 'premium' },
    { ...input, is_active: false },
  ])
    expect((await api(path(), 'PATCH', body, adminCookie)).status).toBe(400)
  expect((await api(path(), 'GET', undefined, adminCookie)).data).toEqual(before)
})

it('rolls back the name if saving the settings fails', async () => {
  const before = (await api(path(), 'GET', undefined, adminCookie)).data
  const update = payload.update.bind(payload)
  const spy = vi.spyOn(payload, 'update').mockImplementation(async args => {
    if (args.collection === 'organization-settings') throw new Error('Controlled settings failure')
    return update(args)
  })
  try {
    expect((await api(path(), 'PATCH', input, adminCookie)).status).toBe(500)
  } finally {
    spy.mockRestore()
  }
  expect((await api(path(), 'GET', undefined, adminCookie)).data).toEqual(before)
})

it('rejects edits to an inactive organization without changes', async () => {
  const before = (await api(path(), 'GET', undefined, adminCookie)).data
  await payload.update({
    collection: 'organizations',
    id: org,
    overrideAccess: true,
    data: { is_active: false },
  })
  expect((await api(path(), 'PATCH', input, adminCookie)).status).toBe(409)
  expect((await api(path(), 'GET', undefined, adminCookie)).data).toEqual(before)
})
