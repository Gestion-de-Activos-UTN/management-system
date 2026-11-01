import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  getPayload,
  handleEndpoints,
  type CollectionSlug,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { departmentsOf } from '@/lib/argentina-geo'
import { relationId } from '@/lib/relationId'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import type { OrganizationCreateInput } from '@/modules/organizations/schema'

let payload: Payload, config: SanitizedConfig, platformCookie: string, fixtureOrg: string
let platformRole: string
const memberCookies = new Map<string, string>()
const password = 'Onboarding-test-2026!'
const endpoint = '/api/v1/platform-admin/organizations'
const trackedCollections = [
  'organizations',
  'organization-settings',
  'subscriptions',
  'offices',
  'users',
  'organization-memberships',
  'assessment-instances',
  'assessment-answers',
  'compliance-results',
  'risk-evaluations',
  'payload-jobs',
  'roles',
  'admins',
] as const satisfies readonly CollectionSlug[]

// Expected product limits are explicit: importing the implementation's defaults would also
// accept an accidental change to those defaults without detecting the regression.
const expectedLimits = {
  basic: { max_offices: 3, user_limits: { org_admin: 1, office_manager: 2, org_viewer: 4 } },
  premium: { max_offices: 10, user_limits: { org_admin: 3, office_manager: 10, org_viewer: 20 } },
}
const expectedFeatures = {
  asset_inventory: true,
  security_assessments: true,
  risk_score: true,
  tasks: true,
}

function input(plan: OrganizationCreateInput['plan'] = 'basic'): OrganizationCreateInput {
  const key = randomUUID()
  return {
    name: `Organización de prueba ${key}`,
    industry: 'technology',
    plan,
    first_office: { name: 'Centro Logístico Rosario', province_id: '82' },
    first_admin: {
      name: 'Administradora de prueba',
      email: `onboarding-${key}@example.test`,
      password,
    },
  }
}

async function api(
  path: string,
  {
    method = 'POST',
    body,
    cookie,
    raw,
  }: { method?: string; body?: unknown; cookie?: string; raw?: string } = {}
) {
  const encoded = raw ?? (body === undefined ? undefined : JSON.stringify(body))
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost${path}`, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(cookie ? { cookie } : {}),
        ...(encoded !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(encoded !== undefined ? { body: encoded } : {}),
    }),
  })
  return { response, status: response.status, data: await response.json() }
}

async function login(email: string, collection: 'users' | 'admins', secret = password) {
  const result = await api(`/api/${collection}/login`, { body: { email, password: secret } })
  expect(result.status, JSON.stringify(result.data)).toBe(200)
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0]
  expect(cookie).toBeTruthy()
  return cookie!
}

// These queries carry no request/transaction from the HTTP operation. They observe committed
// rows through independent local-API reads, not documents returned by the mutation itself.
async function persistedVersions() {
  return Object.fromEntries(
    await Promise.all(
      trackedCollections.map(async collection => {
        const result = await payload.find({
          collection,
          overrideAccess: true,
          depth: 0,
          pagination: false,
        })
        return [
          collection,
          result.docs
            .map(doc => ({ id: String(doc.id), updatedAt: doc.updatedAt }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ]
      })
    )
  )
}

beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_audit@127\.0\.0\.1:55443\/siam_onboarding_[a-z0-9]+$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use a fresh disposable siam_onboarding_* database on port 55443')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node >=22 required')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  expect(
    (await payload.count({ collection: 'organizations', overrideAccess: true })).totalDocs
  ).toBe(0)

  // The separate existing tenant supplies real roles/accounts for negative access controls.
  // It does not exercise the bootstrap function being tested to set up the platform identity.
  const fixture = await seedRiskOrganization(payload)
  fixtureOrg = String(fixture.organization.id)
  for (const role of ['org_admin', 'office_manager', 'org_viewer'] as const) {
    const id = await member(payload, fixtureOrg, [String(fixture.office.id)], role)
    const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
    memberCookies.set(role, await login(user.email, 'users', 'x'.repeat(12)))
  }
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
  platformRole = String(role.id)
  const account = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: { role: role.id, email: 'platform@onboarding.test', password, status: 'active' },
  })
  platformCookie = await login(account.email, 'admins')
}, 60000)

afterAll(async () => {
  vi.restoreAllMocks()
  if (payload) await payload.destroy()
})

async function assertCompleteOrganization(
  result: Awaited<ReturnType<typeof api>>,
  body: OrganizationCreateInput
) {
  expect(result.status, JSON.stringify(result.data)).toBe(201)
  const id = String(result.data.id)
  const normalizedEmail = body.first_admin.email.trim().toLowerCase()
  expect(result.data).toEqual({
    id,
    name: body.name.trim(),
    is_active: true,
    plan: body.plan,
    office: { id: expect.any(String), name: body.first_office.name.trim() },
    first_admin: {
      id: expect.any(String),
      name: body.first_admin.name.trim(),
      email: normalizedEmail,
      role: 'org_admin',
    },
  })
  expect(JSON.stringify(result.data)).not.toContain(password)

  const organization = await payload.findByID({
    collection: 'organizations',
    id,
    overrideAccess: true,
    depth: 0,
  })
  expect(organization.name).toBe(body.name.trim())
  expect(organization.is_active).toBe(true)
  const where = { organization: { equals: id } }
  const [settings, subscriptions, offices, memberships, reviews, users] = await Promise.all([
    payload.find({ collection: 'organization-settings', where, overrideAccess: true, depth: 0 }),
    payload.find({ collection: 'subscriptions', where, overrideAccess: true, depth: 0 }),
    payload.find({ collection: 'offices', where, overrideAccess: true, depth: 0 }),
    payload.find({ collection: 'organization-memberships', where, overrideAccess: true, depth: 0 }),
    payload.find({ collection: 'assessment-instances', where, overrideAccess: true, depth: 0 }),
    payload.find({
      collection: 'users',
      where: { email: { equals: normalizedEmail } },
      overrideAccess: true,
      depth: 0,
    }),
  ])
  for (const result of [settings, subscriptions, offices, memberships, users])
    expect(result.totalDocs).toBe(1)
  expect(reviews.totalDocs).toBe(2)
  expect(relationId(organization.settings)).toBe(String(settings.docs[0].id))
  expect(relationId(organization.subscription)).toBe(String(subscriptions.docs[0].id))
  expect(settings.docs[0]).toMatchObject({
    industry: body.industry,
    assessment_policy_key: 'essential',
    assessment_policy_version: 2,
    snapshot_before_each_scan: false,
  })
  expect(settings.docs[0].industry_details ?? '').toBe(body.industry_details?.trim() ?? '')
  expect(Number.isFinite(Date.parse(settings.docs[0].assessment_policy_selected_at))).toBe(true)
  expect(subscriptions.docs[0]).toMatchObject({
    level: body.plan,
    ...expectedLimits[body.plan],
    features: expectedFeatures,
  })

  const office = offices.docs[0],
    membership = memberships.docs[0],
    user = users.docs[0]
  expect(String(office.id)).toBe(result.data.office.id)
  expect(office).toMatchObject({
    name: body.first_office.name.trim(),
    province_id: body.first_office.province_id,
    is_active: true,
  })
  expect(office.department_id ?? null).toBe(body.first_office.department_id ?? null)
  expect(String(user.id)).toBe(result.data.first_admin.id)
  expect(user).toMatchObject({
    name: body.first_admin.name.trim(),
    email: normalizedEmail,
    status: 'active',
  })
  expect(relationId(user.organization_membership)).toBe(String(membership.id))
  expect(relationId(membership.user)).toBe(String(user.id))
  expect(membership).toMatchObject({ status: 'active', is_active: true })
  expect(membership.offices?.map(relationId)).toEqual([String(office.id)])
  const role = await payload.findByID({
    collection: 'roles',
    id: relationId(membership.role),
    overrideAccess: true,
  })
  expect(role.slug).toBe('org_admin')
  expect(reviews.docs.map(review => review.scope).sort()).toEqual(['office', 'organization'])
  for (const review of reviews.docs) {
    expect(review).toMatchObject({
      status: 'pending',
      created_reason: 'initial',
      policy_key: 'essential',
      policy_version: 2,
      catalog_version: 2,
    })
    expect(
      Array.isArray(review.question_set_snapshot) && review.question_set_snapshot.length > 0
    ).toBe(true)
    expect(review.scope === 'office' ? relationId(review.office) : (review.office ?? null)).toBe(
      review.scope === 'office' ? String(office.id) : null
    )
  }
  return { id, office, user }
}

it.each(['basic', 'premium'] as const)(
  'creates a usable %s organization through platform authentication',
  async plan => {
    const body = input(plan)
    body.name = `  ${body.name}  `
    body.first_admin.email = `  ${body.first_admin.email.toUpperCase()}  `
    body.first_office.department_id = departmentsOf('82')[0].id
    if (plan === 'premium') {
      body.industry = 'other'
      body.industry_details = 'Servicios de logística especializados.'
    }
    const before = await persistedVersions()
    const result = await api(endpoint, { body, cookie: platformCookie })
    const { id, office, user } = await assertCompleteOrganization(result, body)
    const after = await persistedVersions()
    const additions: Partial<Record<(typeof trackedCollections)[number], number>> = {
      organizations: 1,
      'organization-settings': 1,
      subscriptions: 1,
      offices: 1,
      users: 1,
      'organization-memberships': 1,
      'assessment-instances': 2,
    }
    for (const collection of trackedCollections)
      expect(after[collection].length - before[collection].length, collection).toBe(
        additions[collection] ?? 0
      )

    const cookie = await login(user.email, 'users')
    const session = await api('/api/v1/session', { method: 'GET', cookie })
    expect(session.status).toBe(200)
    expect(session.data).toMatchObject({
      userId: String(user.id),
      organizationId: id,
      role: 'org_admin',
      isActive: true,
      isPlatformAdmin: false,
      orgWide: true,
      officeIds: [String(office.id)],
      limits: expectedLimits[plan],
      features: expectedFeatures,
    })
    const own = await api(`/api/organizations/${id}`, { method: 'GET', cookie })
    expect(own.status).toBe(200)
    expect(own.data.id).toBe(id)
  }
)

it.each(['anonymous', 'org_admin', 'office_manager', 'org_viewer', 'visiting_platform'])(
  'rejects creation by %s without persisting anything',
  async actor => {
    const before = await persistedVersions()
    const cookie = actor === 'visiting_platform' ? platformCookie : memberCookies.get(actor)
    const path =
      actor === 'visiting_platform' ? `${endpoint}?asOrganization=${fixtureOrg}` : endpoint
    const result = await api(path, { body: input(), cookie })
    expect(result.status).toBe(actor === 'anonymous' ? 401 : 403)
    expect(result.data.error).toBe(actor === 'anonymous' ? 'unauthenticated' : 'forbidden')
    expect(await persistedVersions()).toEqual(before)
  }
)

it('rejects a deactivated platform account with a previously issued cookie', async () => {
  const account = await payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: { email: 'revoked@onboarding.test', role: platformRole, password, status: 'active' },
  })
  const cookie = await login(account.email, 'admins')
  await payload.update({
    collection: 'admins',
    id: account.id,
    overrideAccess: true,
    data: { status: 'inactive' },
  })
  const before = await persistedVersions()
  expect((await api(endpoint, { body: input(), cookie })).status).toBe(401)
  expect(await persistedVersions()).toEqual(before)
})

const invalidCases: Array<[string, string[], (body: OrganizationCreateInput) => unknown]> = [
  ['blank organization name', ['name'], body => ({ ...body, name: '   ' })],
  ['invalid industry', ['industry'], body => ({ ...body, industry: 'invalid' })],
  [
    'missing plan',
    ['plan'],
    body => {
      const { plan: _, ...rest } = body
      return rest
    },
  ],
  ['invalid plan', ['plan'], body => ({ ...body, plan: 'enterprise' })],
  [
    'missing office name',
    ['first_office', 'name'],
    body => ({ ...body, first_office: { ...body.first_office, name: '' } }),
  ],
  [
    'missing province',
    ['first_office', 'province_id'],
    body => ({ ...body, first_office: { name: body.first_office.name } }),
  ],
  [
    'unknown province',
    ['first_office', 'province_id'],
    body => ({ ...body, first_office: { ...body.first_office, province_id: 'invalid' } }),
  ],
  [
    'department from another province',
    ['first_office', 'department_id'],
    body => ({
      ...body,
      first_office: { ...body.first_office, department_id: departmentsOf('06')[0].id },
    }),
  ],
  [
    'blank administrator name',
    ['first_admin', 'name'],
    body => ({ ...body, first_admin: { ...body.first_admin, name: '' } }),
  ],
  [
    'invalid email',
    ['first_admin', 'email'],
    body => ({ ...body, first_admin: { ...body.first_admin, email: 'invalid' } }),
  ],
  [
    'short password',
    ['first_admin', 'password'],
    body => ({ ...body, first_admin: { ...body.first_admin, password: 'short' } }),
  ],
  [
    'industry details without Other',
    ['industry_details'],
    body => ({ ...body, industry_details: 'Sólo para Otro.' }),
  ],
]

it.each(invalidCases)(
  'rejects %s with field issues and no writes',
  async (_label, expectedPath, change) => {
    const before = await persistedVersions()
    const result = await api(endpoint, { cookie: platformCookie, body: change(input()) })
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('invalid_organization')
    expect(result.data.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expectedPath })])
    )
    expect(await persistedVersions()).toEqual(before)
  }
)

it.each(['', '{"name":', 'null', '[]'])(
  'rejects malformed or incomplete JSON %j without writes',
  async raw => {
    const before = await persistedVersions()
    const result = await api(endpoint, { cookie: platformCookie, raw })
    expect(result.status).toBe(400)
    expect(result.data.error).toBe('invalid_organization')
    expect(await persistedVersions()).toEqual(before)
  }
)

it('rolls back a duplicate email rejection and accepts a corrected email', async () => {
  const existing = (
    await payload.find({ collection: 'users', overrideAccess: true, limit: 1, depth: 0 })
  ).docs[0]
  const body = input()
  body.first_admin.email = `  ${existing.email.toUpperCase()}  `
  const before = await persistedVersions()
  const rejected = await api(endpoint, { body, cookie: platformCookie })
  expect(rejected.status).toBe(409)
  expect(rejected.data.error).toBe('email_unavailable')
  expect(await persistedVersions()).toEqual(before)
  body.first_admin.email = input().first_admin.email
  await assertCompleteOrganization(await api(endpoint, { body, cookie: platformCookie }), body)
})

it('ignores injected identity, activation, scope and quota fields instead of granting them', async () => {
  const body = input()
  const before = await persistedVersions()
  const malicious = {
    ...body,
    id: fixtureOrg,
    is_active: false,
    settings: randomUUID(),
    features: { tasks: false },
    max_offices: 999,
    user_limits: { org_admin: 999 },
    first_office: { ...body.first_office, organization: fixtureOrg, is_active: false },
    first_admin: {
      ...body.first_admin,
      role: 'platform_admin',
      status: 'inactive',
      organization_membership: randomUUID(),
    },
  }
  const result = await api(endpoint, { body: malicious, cookie: platformCookie })
  const created = await assertCompleteOrganization(result, body)
  expect(created.id).not.toBe(fixtureOrg)
  const after = await persistedVersions()
  for (const collection of trackedCollections)
    expect(after[collection], collection).toEqual(expect.arrayContaining(before[collection]))
})

it.each(['organizations', 'users', 'organization-memberships'])(
  'keeps direct POST /api/%s closed even for platform accounts',
  async collection => {
    const before = await persistedVersions()
    expect(
      (await api(`/api/${collection}`, { body: input(), cookie: platformCookie })).status
    ).toBe(403)
    expect(await persistedVersions()).toEqual(before)
  }
)

it.each([
  'organization-settings',
  'subscriptions',
  'offices',
  'users',
  'organization-memberships',
] as const)(
  'rolls back real writes after creating %s and accepts the same request on retry',
  async failureCollection => {
    const body = input()
    const before = await persistedVersions()
    const create = payload.create.bind(payload)
    const pending: Promise<unknown>[] = []
    let failedId: string | undefined
    let linkedUser: string | undefined
    const spy = vi.spyOn(payload, 'create').mockImplementation((options => {
      const operation = create(options).then(async doc => {
        if (options.collection === failureCollection) {
          failedId = String(doc.id)
          if (options.collection === 'organization-memberships') {
            const user = await payload.findByID({
              collection: 'users',
              id: relationId((doc as { user: string }).user),
              overrideAccess: true,
              depth: 0,
              req: options.req,
            })
            linkedUser = relationId(user.organization_membership)
          }
          throw new Error(`Controlled onboarding failure after ${failureCollection}`)
        }
        return doc
      })
      pending.push(operation)
      return operation
    }) as typeof payload.create)
    let rejected: Awaited<ReturnType<typeof api>>
    try {
      rejected = await api(endpoint, { body, cookie: platformCookie })
      // Promise.all creates settings/subscription together; wait for both branches before
      // inspecting committed state, so a late continuation cannot make this a false green.
      await Promise.allSettled(pending)
    } finally {
      spy.mockRestore()
    }
    expect(rejected!.status).toBe(500)
    expect(failedId, 'the injected failure must occur after a real persisted create').toBeTruthy()
    if (failureCollection === 'organization-memberships') expect(linkedUser).toBe(failedId)
    expect(await persistedVersions()).toEqual(before)
    const users = await payload.count({
      collection: 'users',
      overrideAccess: true,
      where: { email: { equals: body.first_admin.email } },
    })
    expect(users.totalDocs).toBe(0)

    await assertCompleteOrganization(await api(endpoint, { body, cookie: platformCookie }), body)
    const organizations = await payload.count({
      collection: 'organizations',
      overrideAccess: true,
      where: { name: { equals: body.name } },
    })
    expect(organizations.totalDocs).toBe(1)
  }
)
