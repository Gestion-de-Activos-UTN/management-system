import { afterAll, beforeAll, expect, it } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'

let f: ScopeFixture
const messages: Record<string, any> = {}
const management = '/v1/platform-admin/portal-messages',
  inbox = '/v1/portal-messages'
function input(audience: unknown, extra: Record<string, unknown> = {}) {
  return {
    title: 'Mensaje de prueba',
    description: 'Información destinada a su audiencia.',
    message_type: 'notice',
    audience,
    is_active: true,
    ...extra,
  }
}
async function publish(body: unknown) {
  const result = await f.api(management, f.platform, 'POST', body)
  expect(result.status, result.data.error).toBe(201)
  return result.data
}
const organizationAudience = () => ({
  scope: 'organizations',
  target_kind: 'all',
  organization_ids: [f.own.org],
})
beforeAll(async () => {
  f = await scopeFixture('messages')
  messages.global = await publish(input({ scope: 'global' }, { title: 'Mensaje global' }))
  messages.own = await publish(
    input(organizationAudience(), { title: 'Mensaje de organización propia' })
  )
  for (const [key, role] of [
    ['manager', 'office_manager'],
    ['viewer', 'org_viewer'],
  ] as const) {
    messages[key] = await publish(
      input(
        {
          scope: 'organizations',
          target_kind: 'role',
          organization_ids: [f.own.org],
          role_slugs: [role],
        },
        { title: `Mensaje para ${key}` }
      )
    )
  }
  messages.user = await publish(
    input(
      {
        scope: 'organizations',
        target_kind: 'user',
        organization_ids: [f.own.org],
        user_ids: [f.own.viewer],
      },
      { title: 'Mensaje para una persona' }
    )
  )
  messages.foreign = await publish(
    input(
      { scope: 'organizations', target_kind: 'all', organization_ids: [f.foreign.org] },
      { title: 'Mensaje privado de otra organización' }
    )
  )
}, 60000)
afterAll(async () => {
  if (f) await f.payload.destroy()
})

for (const actor of ['admin', 'manager', 'viewer', 'foreign'] as const) {
  it(`${actor}: delivery exposes only global and matching organization/role/person audiences`, async () => {
    const before = await f.versions()
    const cookie = actor === 'foreign' ? f.foreign.viewerCookie : f.own[`${actor}Cookie`]
    const result = await f.api(inbox, cookie)
    expect(result.status).toBe(200)
    const expected =
      actor === 'foreign'
        ? [messages.global.id, messages.foreign.id]
        : actor === 'admin'
          ? [messages.global.id, messages.own.id]
          : actor === 'manager'
            ? [messages.global.id, messages.own.id, messages.manager.id]
            : [messages.global.id, messages.own.id, messages.viewer.id, messages.user.id]
    expect(result.data.docs.map((row: any) => row.id).sort()).toEqual(expected.sort())
    expect(await f.versions()).toEqual(before)
  })
}

for (const actor of ['anonymous', 'platform', 'visited'] as const) {
  it(`${actor}: user inbox, receipt and link resolution are unavailable`, async () => {
    const cookie = actor === 'anonymous' ? '' : f.platform
    const suffix = actor === 'visited' ? `?asOrganization=${f.own.org}` : ''
    const before = await f.versions()
    for (const [path, method, body] of [
      [inbox, 'GET', undefined],
      [`${inbox}/${messages.own.id}/receipt`, 'PATCH', { status: 'seen' }],
      [`${inbox}/${messages.own.id}/resolve-link`, 'GET', undefined],
    ] as const)
      expect((await f.api(path + suffix, cookie, method, body)).status).toBe(
        actor === 'anonymous' ? 401 : 403
      )
    expect(await f.versions()).toEqual(before)
  })
}

for (const actor of ['admin', 'manager', 'viewer', 'visited', 'anonymous'] as const) {
  it(`${actor}: a valid message cannot bypass StaffPortal-only management`, async () => {
    const cookie =
      actor === 'anonymous' ? '' : actor === 'visited' ? f.platform : f.own[`${actor}Cookie`]
    const suffix = actor === 'visited' ? `?asOrganization=${f.own.org}` : ''
    const before = await f.versions()
    const valid = input(organizationAudience())
    for (const [path, method, body] of [
      [management, 'GET', undefined],
      [management, 'POST', valid],
      [`${management}/${messages.own.id}`, 'PATCH', valid],
      [`${management}/${messages.own.id}/replay`, 'POST', {}],
    ] as const)
      expect((await f.api(path + suffix, cookie, method, body)).status).toBe(
        actor === 'anonymous' ? 401 : 403
      )
    expect(await f.versions()).toEqual(before)
  })
}

it('StaffPortal can list, update and replay a message using the dedicated endpoints', async () => {
  const list = await f.api(management, f.platform)
  expect(list.status).toBe(200)
  expect(list.data.docs.some((row: any) => row.id === messages.own.id)).toBe(true)
  const updated = await f.api(
    `${management}/${messages.own.id}`,
    f.platform,
    'PATCH',
    input(organizationAudience(), { title: 'Título actualizado' })
  )
  expect(updated.status).toBe(200)
  expect(
    (
      await f.payload.findByID({
        collection: 'portal-messages',
        id: messages.own.id,
        overrideAccess: true,
      })
    ).title
  ).toBe('Título actualizado')
  const previous = updated.data.delivery_version
  const replayed = await f.api(`${management}/${messages.own.id}/replay`, f.platform, 'POST', {})
  expect(replayed.status).toBe(200)
  const saved = await f.payload.findByID({
    collection: 'portal-messages',
    id: messages.own.id,
    overrideAccess: true,
  })
  expect(saved.delivery_version).toBe(Number(previous) + 1)
})

for (const key of ['foreign', 'user', 'manager'] as const) {
  it(`a nonrecipient cannot acknowledge or resolve a ${key} message by its ID`, async () => {
    const cookie = key === 'user' ? f.own.managerCookie : f.own.viewerCookie
    const before = await f.versions()
    const message = messages[key]
    for (const [path, method, body] of [
      [`${inbox}/${message.id}/receipt`, 'PATCH', { status: 'seen' }],
      [`${inbox}/${message.id}/resolve-link`, 'GET', undefined],
    ] as const) {
      const result = await f.api(path, cookie, method, body)
      expect(result.status).toBe(404)
      expect(JSON.stringify(result.data)).not.toContain(message.title)
    }
    expect(await f.versions()).toEqual(before)
  })
}

it('receipt identity is derived from the session and cannot be impersonated in the body', async () => {
  const result = await f.api(`${inbox}/${messages.user.id}/receipt`, f.own.viewerCookie, 'PATCH', {
    status: 'seen',
    user: f.foreign.viewer,
    organization: f.foreign.org,
    message: messages.foreign.id,
  })
  expect(result.status).toBe(200)
  const rows = await f.payload.find({
    collection: 'portal-message-receipts',
    overrideAccess: true,
    where: { message: { equals: messages.user.id } },
    depth: 0,
  })
  expect(rows.totalDocs).toBe(1)
  expect(relationId(rows.docs[0].user)).toBe(f.own.viewer)
  expect(relationId(rows.docs[0].message)).toBe(messages.user.id)
  expect(
    (
      await f.payload.count({
        collection: 'portal-message-receipts',
        overrideAccess: true,
        where: { user: { equals: f.foreign.viewer } },
      })
    ).totalDocs
  ).toBe(0)
})

it('a linked entity in another office exposes neither its label nor its URL to a recipient without access', async () => {
  const asset = await f.createManual(f.own, {
    office: f.own.second,
    owner: f.own.outside,
    alias: 'Equipo privado de otra oficina',
  })
  const message = await publish(
    input(organizationAudience(), {
      linked_section: 'inventory',
      linked_entity_type: 'non-network-assets',
      linked_entity: { relationTo: 'non-network-assets', value: asset.id },
    })
  )
  const list = await f.api(inbox, f.own.viewerCookie)
  const received = list.data.docs.find((row: any) => row.id === message.id)
  expect(received).toBeTruthy()
  expect(received.entity.access).toBe('denied')
  expect(JSON.stringify(received.entity)).not.toContain(asset.alias)
  expect(JSON.stringify(received.entity)).not.toContain(asset.id)
  const denied = await f.api(`${inbox}/${message.id}/resolve-link`, f.own.viewerCookie)
  expect(denied.status).toBe(200)
  expect(denied.data.url).toBeNull()
  const allowed = await f.api(`${inbox}/${message.id}/resolve-link`, f.own.adminCookie)
  expect(allowed.status).toBe(200)
  expect(allowed.data.url).toContain(asset.id)
})

it('delivery rechecks the current role even when the cookie has not changed', async () => {
  expect(
    (await f.api(inbox, f.own.managerCookie)).data.docs.some(
      (row: any) => row.id === messages.manager.id
    )
  ).toBe(true)
  expect(
    (
      await f.api(`/v1/org-members/${f.own.manager}`, f.own.adminCookie, 'PATCH', {
        role: 'org_viewer',
      })
    ).status
  ).toBe(200)
  const result = await f.api(inbox, f.own.managerCookie)
  expect(result.status).toBe(200)
  expect(result.data.docs.some((row: any) => row.id === messages.manager.id)).toBe(false)
  expect(result.data.docs.some((row: any) => row.id === messages.viewer.id)).toBe(true)
  expect(
    (
      await f.api(`/v1/org-members/${f.own.manager}`, f.own.adminCookie, 'PATCH', {
        role: 'office_manager',
      })
    ).status
  ).toBe(200)
})

for (const collection of ['portal-messages', 'portal-message-receipts'] as const) {
  it(`${collection}: direct collection REST cannot bypass the dedicated API`, async () => {
    const before = await f.versions()
    for (const cookie of [f.platform, f.own.adminCookie, f.own.viewerCookie]) {
      expect((await f.api(`/${collection}`, cookie)).status).toBe(403)
      expect((await f.api(`/${collection}`, cookie, 'POST', { title: 'Inyección' })).status).toBe(
        403
      )
    }
    expect(await f.versions()).toEqual(before)
  })
}

it('organization deactivation revokes inbox and receipt access for an existing cookie', async () => {
  await f.deactivate()
  const before = await f.versions()
  expect((await f.api(inbox, f.own.viewerCookie)).status).toBe(401)
  expect(
    (
      await f.api(`${inbox}/${messages.own.id}/receipt`, f.own.viewerCookie, 'PATCH', {
        status: 'seen',
      })
    ).status
  ).toBe(401)
  expect(await f.versions()).toEqual(before)
})
