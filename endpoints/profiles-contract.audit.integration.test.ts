import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'
import { createInventorySnapshot } from '@/domain/inventories/createInventorySnapshot'

let f: ScopeFixture, platformId: string, secondPlatform: string, secondCookie: string
const memberPath = '/v1/me/profile',
  platformPath = '/v1/platform-admin-profile'
beforeAll(async () => {
  f = await scopeFixture('profiles')
  platformId = (await f.api('/v1/session', f.platform)).data.userId
  const primary = await f.payload.findByID({
    collection: 'admins',
    id: platformId,
    overrideAccess: true,
  })
  const other = await f.payload.create({
    collection: 'admins',
    overrideAccess: true,
    data: {
      name: 'Segunda administradora',
      role: relationId(primary.role),
      status: 'active',
      email: 'second-platform@scope.test',
      password: 'Scope-test-2026!',
    },
  })
  secondPlatform = String(other.id)
  secondCookie = await f.login(secondPlatform, 'admins')
  // A real persisted evaluation makes the "profile does not change risk" assertions meaningful.
  await createInventorySnapshot(f.payload, f.own.office, { type: 'scheduled' })
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})
async function unchangedExcept(
  before: Awaited<ReturnType<ScopeFixture['versions']>>,
  collection: 'users' | 'admins'
) {
  const after = await f.versions()
  expect(before['risk-evaluations'].length).toBeGreaterThan(0)
  for (const key of Object.keys(before))
    if (key !== collection) expect(after[key], key).toEqual(before[key])
}

for (const actor of ['admin', 'manager', 'viewer', 'platform', 'visited', 'anonymous'] as const) {
  const cookie = () =>
    actor === 'anonymous'
      ? ''
      : actor === 'platform' || actor === 'visited'
        ? f.platform
        : f.own[`${actor}Cookie`]
  const suffix = () => (actor === 'visited' ? `?asOrganization=${f.own.org}` : '')
  for (const type of ['member', 'platform'] as const)
    for (const method of ['GET', 'PATCH'] as const) {
      it(`${actor}: ${method} ${type} profile authenticates the correct account collection`, async () => {
        const allowed =
          type === 'member'
            ? ['admin', 'manager', 'viewer'].includes(actor)
            : actor === 'platform' || actor === 'visited'
        const before = await f.versions()
        const result = await f.api(
          (type === 'member' ? memberPath : platformPath) + suffix(),
          cookie(),
          method,
          method === 'PATCH' ? { name: 'Nombre actualizado' } : undefined
        )
        expect(result.status).toBe(allowed ? 200 : actor === 'anonymous' ? 401 : 403)
        if (!allowed || method === 'GET') expect(await f.versions()).toEqual(before)
        if (allowed) {
          expect(Object.keys(result.data).sort()).toEqual(
            (type === 'member'
              ? ['name', 'email', 'role', 'organization', 'all_offices', 'offices']
              : ['name', 'email']
            ).sort()
          )
          if (type === 'member') {
            expect(result.data.role).toBe(
              `org_${actor}` === 'org_manager' ? 'office_manager' : `org_${actor}`
            )
            expect(result.data.organization.id).toBe(f.own.org)
            expect(result.data.all_offices).toBe(actor === 'admin')
            expect(result.data.offices.map((office: { id: string }) => office.id).sort()).toEqual(
              (actor === 'admin' ? [f.own.office, f.own.second] : [f.own.office]).sort()
            )
            expect(JSON.stringify(result.data)).not.toContain(f.foreign.org)
            if (method === 'PATCH') {
              expect(
                (
                  await f.payload.findByID({
                    collection: 'users',
                    id: f.own[actor as 'admin' | 'manager' | 'viewer'],
                    overrideAccess: true,
                  })
                ).name
              ).toBe('Nombre actualizado')
              await unchangedExcept(before, 'users')
            }
          } else if (method === 'PATCH') {
            expect(
              (
                await f.payload.findByID({
                  collection: 'admins',
                  id: platformId,
                  overrideAccess: true,
                })
              ).name
            ).toBe('Nombre actualizado')
            await unchangedExcept(before, 'admins')
          }
        }
      })
    }
}

for (const type of ['member', 'platform'] as const) {
  for (const body of [
    {},
    { name: null },
    { name: 123 },
    { name: '' },
    { name: '  ' },
    { name: 'Ana123' },
    { name: 'Ana <script>' },
    { name: 'A'.repeat(121) },
  ]) {
    it(`${type}: rejects invalid name ${JSON.stringify(body)} at its field without writing`, async () => {
      const before = await f.versions()
      const result = await f.api(
        type === 'member' ? memberPath : platformPath,
        type === 'member' ? f.own.viewerCookie : f.platform,
        'PATCH',
        body
      )
      expect(result.status).toBe(400)
      expect(result.data.error).toBe('invalid_profile')
      expect(result.data.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['name'] })])
      )
      expect(await f.versions()).toEqual(before)
    })
  }
}

for (const [type, name] of [
  ['member', 'É'],
  ['member', 'Á'.repeat(120)],
  ['platform', 'Él'],
  ['platform', 'Á'.repeat(120)],
] as const) {
  it(`${type}: accepts the declared name length ${name.length} after trimming spaces`, async () => {
    const result = await f.api(
      type === 'member' ? memberPath : platformPath,
      type === 'member' ? f.own.viewerCookie : f.platform,
      'PATCH',
      { name: `  ${name}  ` }
    )
    expect(result.status).toBe(200)
    expect(result.data.name).toBe(name)
  })
}

it('platform profile enforces its two-character minimum without imposing it on member profiles', async () => {
  const before = await f.versions()
  const result = await f.api(platformPath, f.platform, 'PATCH', { name: 'É' })
  expect(result.status).toBe(400)
  expect(await f.versions()).toEqual(before)
})

it('member profile discards protected identity/access fields and cannot target another account', async () => {
  const original = await f.payload.findByID({
    collection: 'users',
    id: f.own.viewer,
    overrideAccess: true,
    depth: 0,
  })
  const foreign = await f.payload.findByID({
    collection: 'users',
    id: f.foreign.viewer,
    overrideAccess: true,
    depth: 0,
  })
  const membership = (
    await f.payload.find({
      collection: 'organization-memberships',
      overrideAccess: true,
      where: { user: { equals: f.own.viewer } },
      depth: 0,
      limit: 1,
    })
  ).docs[0]
  const result = await f.api(memberPath, f.own.viewerCookie, 'PATCH', {
    name: '  María O’Connor  ',
    id: f.foreign.viewer,
    user_id: f.foreign.viewer,
    email: 'forged@example.test',
    password: 'Forged-password-2026!',
    role: 'org_admin',
    status: 'inactive',
    organization: f.foreign.org,
    organization_membership: f.foreign.admin,
    offices: [f.foreign.office],
    sessions: [],
    hash: 'forged',
    salt: 'forged',
  })
  expect(result.status).toBe(200)
  expect(result.data.name).toBe('María O’Connor')
  const row = await f.payload.findByID({
    collection: 'users',
    id: f.own.viewer,
    overrideAccess: true,
    depth: 0,
  })
  expect(row).toMatchObject({
    id: original.id,
    email: original.email,
    status: 'active',
    organization_membership: original.organization_membership,
  })
  expect(
    await f.payload.findByID({
      collection: 'users',
      id: f.foreign.viewer,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(foreign)
  expect(
    await f.payload.findByID({
      collection: 'organization-memberships',
      id: membership.id,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(membership)
  const session = await f.api('/v1/session', f.own.viewerCookie)
  expect(session.data).toMatchObject({
    role: 'org_viewer',
    organizationId: f.own.org,
    officeIds: [f.own.office],
  })
  // Real login proves that the attempted password/hash replacement did not take effect.
  f.own.viewerCookie = await f.login(f.own.viewer)
})

it('platform profile edits only the authenticated administrator name and preserves credentials', async () => {
  const original = await f.payload.findByID({
    collection: 'admins',
    id: platformId,
    overrideAccess: true,
    depth: 0,
  })
  const other = await f.payload.findByID({
    collection: 'admins',
    id: secondPlatform,
    overrideAccess: true,
    depth: 0,
  })
  const result = await f.api(platformPath, f.platform, 'PATCH', {
    name: '  Administradora Ñandú  ',
    id: secondPlatform,
    email: 'forged@example.test',
    password: 'Forged-password-2026!',
    role: f.own.viewer,
    status: 'inactive',
    sessions: [],
    hash: 'forged',
    salt: 'forged',
  })
  expect(result.status).toBe(200)
  expect(result.data).toEqual({ name: 'Administradora Ñandú', email: original.email })
  const row = await f.payload.findByID({
    collection: 'admins',
    id: platformId,
    overrideAccess: true,
    depth: 0,
  })
  expect(row).toMatchObject({
    id: original.id,
    role: original.role,
    status: original.status,
    email: original.email,
  })
  expect(
    await f.payload.findByID({
      collection: 'admins',
      id: secondPlatform,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(other)
  f.platform = await f.login(platformId, 'admins')
  expect((await f.api(platformPath, secondCookie)).data.name).toBe(other.name)
})

it('asOrganization cannot switch a member personal profile into a different organization', async () => {
  const foreign = await f.payload.findByID({
    collection: 'users',
    id: f.foreign.viewer,
    overrideAccess: true,
    depth: 0,
  })
  const result = await f.api(
    `${memberPath}?asOrganization=${f.foreign.org}`,
    f.own.viewerCookie,
    'PATCH',
    { name: 'Perfil propio' }
  )
  expect(result.status).toBe(200)
  expect(result.data.organization.id).toBe(f.own.org)
  expect(
    await f.payload.findByID({
      collection: 'users',
      id: f.foreign.viewer,
      overrideAccess: true,
      depth: 0,
    })
  ).toEqual(foreign)
})

it('a personal profile omits inactive offices while preserving organization-wide status', async () => {
  const office = await f.payload.findByID({
    collection: 'offices',
    id: f.own.second,
    overrideAccess: true,
  })
  expect(
    (
      await f.api(`/v1/offices/${office.id}/status`, f.own.adminCookie, 'POST', {
        is_active: false,
        confirm_name: office.name,
        manual_asset_decisions: [],
      })
    ).status
  ).toBe(200)
  const result = await f.api(memberPath, f.own.adminCookie)
  expect(result.status).toBe(200)
  expect(result.data.all_offices).toBe(true)
  expect(result.data.offices.map((row: { id: string }) => row.id)).toEqual([f.own.office])
})

for (const type of ['member', 'platform'] as const) {
  it(`${type}: a controlled profile write failure leaves data unchanged and permits retry`, async () => {
    const before = await f.versions(),
      update = f.payload.update.bind(f.payload),
      collection = type === 'member' ? 'users' : 'admins'
    const spy = vi.spyOn(f.payload, 'update').mockImplementation(async args => {
      if (args.collection === collection) throw new Error('Controlled profile write failure')
      return update(args)
    })
    try {
      expect(
        (
          await f.api(
            type === 'member' ? memberPath : platformPath,
            type === 'member' ? f.own.viewerCookie : f.platform,
            'PATCH',
            { name: 'Reintento correcto' }
          )
        ).status
      ).toBe(500)
    } finally {
      spy.mockRestore()
    }
    expect(await f.versions()).toEqual(before)
    expect(
      (
        await f.api(
          type === 'member' ? memberPath : platformPath,
          type === 'member' ? f.own.viewerCookie : f.platform,
          'PATCH',
          { name: 'Reintento correcto' }
        )
      ).status
    ).toBe(200)
  })
}

it('raw user/admin collection routes cannot bypass the dedicated profile commands', async () => {
  const before = await f.versions()
  for (const cookie of [f.own.viewerCookie, f.platform])
    for (const path of [`/users/${f.own.viewer}`, `/admins/${platformId}`]) {
      expect((await f.api(path, cookie)).status).toBe(403)
      expect((await f.api(path, cookie, 'PATCH', { name: 'Intento directo' })).status).toBe(403)
    }
  expect(await f.versions()).toEqual(before)
})

it('an inactive platform account cannot reuse its previous profile cookie', async () => {
  await f.payload.update({
    collection: 'admins',
    id: secondPlatform,
    overrideAccess: true,
    data: { status: 'inactive' },
  })
  const before = await f.versions()
  expect((await f.api(platformPath, secondCookie)).status).toBe(401)
  expect(
    (await f.api(platformPath, secondCookie, 'PATCH', { name: 'Cuenta inactiva' })).status
  ).toBe(401)
  expect((await f.api(platformPath, f.platform)).status).toBe(200)
  expect(await f.versions()).toEqual(before)
})

it('deactivating a tenant revokes its member profile but not the visiting platform administrator personal profile', async () => {
  expect((await f.api(memberPath, f.own.viewerCookie)).status).toBe(200)
  await f.deactivate()
  const before = await f.versions()
  expect((await f.api(memberPath, f.own.viewerCookie)).status).toBe(401)
  expect(
    (await f.api(memberPath, f.own.viewerCookie, 'PATCH', { name: 'No guardar' })).status
  ).toBe(401)
  expect(await f.versions()).toEqual(before)
  const suffix = `?asOrganization=${f.own.org}`
  expect((await f.api(platformPath + suffix, f.platform)).status).toBe(200)
  const result = await f.api(platformPath + suffix, f.platform, 'PATCH', {
    name: 'Perfil personal de plataforma',
  })
  expect(result.status).toBe(200)
  expect(result.data.name).toBe('Perfil personal de plataforma')
})
