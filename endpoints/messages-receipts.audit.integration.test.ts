import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'
import { relationId } from '@/lib/relationId'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'

let f: ScopeFixture
const management = '/v1/platform-admin/portal-messages',
  inbox = '/v1/portal-messages'
const audience = () => ({
  scope: 'organizations',
  target_kind: 'all',
  organization_ids: [f.own.org],
})
function input(extra: Record<string, unknown> = {}) {
  return {
    title: `Mensaje ${crypto.randomUUID()}`,
    description: 'Información destinada a su audiencia.',
    message_type: 'notice',
    audience: audience(),
    is_active: true,
    ...extra,
  }
}
async function publish(extra: Record<string, unknown> = {}) {
  const result = await f.api(management, f.platform, 'POST', input(extra))
  expect(result.status, result.data.error).toBe(201)
  return result.data as { id: string; title: string }
}
const receipt = (id: string, cookie: string, body: Record<string, unknown>) =>
  f.api(`${inbox}/${id}/receipt`, cookie, 'PATCH', body)
const replay = (id: string) => f.api(`${management}/${id}/replay`, f.platform, 'POST', {})
async function mine(cookie: string, id: string) {
  const result = await f.api(inbox, cookie)
  expect(result.status).toBe(200)
  return result.data.docs.find((row: any) => row.id === id) as
    { delivery_version: number; seen: boolean; dismissed: boolean } | undefined
}
async function rows(message: string, user?: string) {
  const found = await f.payload.find({
    collection: 'portal-message-receipts',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    where: {
      and: [{ message: { equals: message } }, ...(user ? [{ user: { equals: user } }] : [])],
    },
  })
  return found.docs
}
const version = async (id: string) =>
  Number(
    (await f.payload.findByID({ collection: 'portal-messages', id, overrideAccess: true }))
      .delivery_version
  )

/**
 * Holds the next receipt lookup of the endpoint after it has read the database, so a second
 * request can complete in between. Reproduces the interleaving deterministically.
 */
function holdNextReceiptLookup() {
  let release!: () => void, arrived!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const reached = new Promise<void>(resolve => (arrived = resolve))
  const original = f.payload.find.bind(f.payload)
  const spy = vi.spyOn(f.payload, 'find').mockImplementation((async (args: any) => {
    if (args.collection !== 'portal-message-receipts' || args.limit !== 1) return original(args)
    spy.mockRestore()
    const result = await original(args)
    arrived()
    await gate
    return result
  }) as never)
  return { reached, release }
}

/**
 * Sends a dismissal while the held seen is in flight. Without serialization it completes inside
 * the window; with it, it waits for the seen and runs after it. Either way it must answer 200.
 */
async function dismissWhileHeld(
  hold: ReturnType<typeof holdNextReceiptLookup>,
  id: string,
  deliveryVersion: number
) {
  const dismissed = receipt(id, f.own.viewerCookie, {
    status: 'dismissed',
    delivery_version: deliveryVersion,
  })
  await Promise.race([dismissed, new Promise(resolve => setTimeout(resolve, 500))])
  hold.release()
  expect((await dismissed).status).toBe(200)
}

beforeAll(async () => {
  f = await scopeFixture('receipts')
}, 60000)
afterAll(async () => {
  vi.restoreAllMocks()
  if (f) await f.payload.destroy()
})

it('parallel first reads of one person leave a single receipt and every request succeeds', async () => {
  const message = await publish()
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })
    )
  )
  expect(results.map(result => result.status)).toEqual(Array(8).fill(200))
  const saved = await rows(message.id)
  expect(saved).toHaveLength(1)
  expect(relationId(saved[0].user)).toBe(f.own.viewer)
  expect(saved[0].seen_at).toBeTruthy()
  expect(saved[0].dismissed_at ?? null).toBeNull()
})

it('parallel receipts of different people never write or alter another person receipt', async () => {
  const message = await publish()
  const actors = [
    [f.own.viewer, f.own.viewerCookie, 'dismissed'],
    [f.own.manager, f.own.managerCookie, 'seen'],
    [f.own.admin, f.own.adminCookie, 'dismissed'],
    [f.own.outside, f.own.outsideCookie, 'seen'],
  ] as const
  const results = await Promise.all(
    actors.flatMap(([, cookie, status]) => [
      receipt(message.id, cookie, { status, delivery_version: 1 }),
      receipt(message.id, cookie, { status, delivery_version: 1 }),
    ])
  )
  expect(results.every(result => result.status === 200)).toBe(true)
  for (const [user, , status] of actors) {
    const own = await rows(message.id, user)
    expect(own).toHaveLength(1)
    expect(Boolean(own[0].dismissed_at)).toBe(status === 'dismissed')
  }
  const manager = (await rows(message.id, f.own.manager))[0]
  expect(
    (await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })).status
  ).toBe(200)
  expect((await rows(message.id, f.own.manager))[0]).toEqual(manager)
  expect(await rows(message.id)).toHaveLength(4)
})

it('a first-read seen in flight does not undo a concurrent dismissal', async () => {
  const message = await publish()
  const hold = holdNextReceiptLookup()
  const seen = receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })
  await hold.reached
  await dismissWhileHeld(hold, message.id, 1)
  expect((await seen).status).toBe(200)
  const saved = await rows(message.id, f.own.viewer)
  expect(saved).toHaveLength(1)
  expect(saved[0].dismissed_at).toBeTruthy()
  expect((await mine(f.own.viewerCookie, message.id))?.dismissed).toBe(true)
})

it('a seen in flight for a replayed delivery does not undo a concurrent dismissal of it', async () => {
  const message = await publish()
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 })
  expect((await replay(message.id)).data.delivery_version).toBe(2)
  const hold = holdNextReceiptLookup()
  const seen = receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 2 })
  await hold.reached
  await dismissWhileHeld(hold, message.id, 2)
  expect((await seen).status).toBe(200)
  const saved = await rows(message.id, f.own.viewer)
  expect(saved).toHaveLength(1)
  expect(Number(saved[0].delivery_version)).toBe(2)
  expect(saved[0].dismissed_at).toBeTruthy()
})

it('receipts for an older or unknown delivery are acknowledged as stale without writing', async () => {
  const message = await publish()
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 })
  await replay(message.id)
  const before = await rows(message.id, f.own.viewer)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({
    delivery_version: 2,
    seen: false,
    dismissed: false,
  })
  for (const stale of [1, 3]) {
    const result = await receipt(message.id, f.own.viewerCookie, {
      status: 'dismissed',
      delivery_version: stale,
    })
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ ok: true, stale: true })
  }
  for (const invalid of [0, -1, 1.5, '2'])
    expect(
      (await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: invalid }))
        .status
    ).toBe(400)
  expect(await rows(message.id, f.own.viewer)).toEqual(before)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({
    seen: false,
    dismissed: false,
  })
})

it('the current delivery restarts the state: seen clears the old dismissal and a later seen keeps the new one', async () => {
  const message = await publish()
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 })
  await replay(message.id)
  await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 2 })
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({ seen: true, dismissed: false })
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed' })
  await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 2 })
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({ seen: true, dismissed: true })
  const saved = await rows(message.id, f.own.viewer)
  expect(saved).toHaveLength(1)
  expect(Number(saved[0].delivery_version)).toBe(2)
})

it('a receipt sent after a replay for the previous delivery cannot dismiss the new one', async () => {
  const message = await publish()
  const viewed = await mine(f.own.viewerCookie, message.id)
  expect(viewed?.delivery_version).toBe(1)
  await replay(message.id)
  const late = await receipt(message.id, f.own.viewerCookie, {
    status: 'dismissed',
    delivery_version: viewed!.delivery_version,
  })
  expect(late.data).toEqual({ ok: true, stale: true })
  expect(await rows(message.id, f.own.viewer)).toHaveLength(0)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({
    delivery_version: 2,
    seen: false,
    dismissed: false,
  })
})

it('concurrent replays raise the delivery and never answer a version above the persisted one', async () => {
  const message = await publish()
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 })
  const results = await Promise.all([replay(message.id), replay(message.id)])
  expect(results.map(result => result.status)).toEqual([200, 200])
  const saved = await version(message.id)
  expect(saved).toBeGreaterThan(1)
  expect(Math.max(...results.map(result => result.data.delivery_version))).toBe(saved)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({
    delivery_version: saved,
    seen: false,
    dismissed: false,
  })
})

it('editing or deactivating and reactivating keeps the delivery and every person state', async () => {
  const message = await publish()
  await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 })
  await receipt(message.id, f.own.managerCookie, { status: 'seen', delivery_version: 1 })
  const before = await rows(message.id)
  const edited = await f.api(
    `${management}/${message.id}`,
    f.platform,
    'PATCH',
    input({ title: 'Texto corregido' })
  )
  expect(edited.status).toBe(200)
  expect(await version(message.id)).toBe(1)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({ seen: true, dismissed: true })
  expect(
    (
      await f.api(
        `${management}/${message.id}`,
        f.platform,
        'PATCH',
        input({ title: 'Texto corregido', is_active: false })
      )
    ).status
  ).toBe(200)
  expect(await mine(f.own.viewerCookie, message.id)).toBeUndefined()
  expect(
    (await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })).status
  ).toBe(404)
  expect((await replay(message.id)).status).toBe(409)
  expect(
    (await f.api(`${management}/${message.id}`, f.platform, 'PATCH', input({ title: 'Activo' })))
      .status
  ).toBe(200)
  expect(await mine(f.own.viewerCookie, message.id)).toMatchObject({ seen: true, dismissed: true })
  expect(await mine(f.own.managerCookie, message.id)).toMatchObject({
    seen: true,
    dismissed: false,
  })
  expect(await rows(message.id)).toEqual(before)
})

it('an expired message leaves delivery, receipts, links and replay without writing or deleting history', async () => {
  const message = await publish({ linked_section: 'inventory' })
  await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })
  expect(
    (
      await f.api(
        `${management}/${message.id}`,
        f.platform,
        'PATCH',
        input({
          linked_section: 'inventory',
          expires_at: new Date(Date.now() - 1000).toISOString(),
        })
      )
    ).status
  ).toBe(200)
  const before = await f.versions()
  expect(await mine(f.own.viewerCookie, message.id)).toBeUndefined()
  for (const [path, method, body] of [
    [`${inbox}/${message.id}/receipt`, 'PATCH', { status: 'dismissed', delivery_version: 1 }],
    [`${inbox}/${message.id}/resolve-link`, 'GET', undefined],
  ] as const) {
    const result = await f.api(path, f.own.viewerCookie, method, body)
    expect(result.status).toBe(404)
    expect(JSON.stringify(result.data)).not.toContain(message.title)
  }
  expect((await replay(message.id)).status).toBe(409)
  expect(await f.versions()).toEqual(before)
  expect(await rows(message.id, f.own.viewer)).toHaveLength(1)
})

it('a message stops being delivered and acknowledged once its expiry instant passes', async () => {
  const expires = Date.now() + 1500
  const message = await publish({ expires_at: new Date(expires).toISOString() })
  expect(await mine(f.own.viewerCookie, message.id)).toBeTruthy()
  expect(
    (await receipt(message.id, f.own.viewerCookie, { status: 'seen', delivery_version: 1 })).status
  ).toBe(200)
  await new Promise(resolve => setTimeout(resolve, Math.max(0, expires - Date.now()) + 50))
  expect(await mine(f.own.viewerCookie, message.id)).toBeUndefined()
  expect(
    (await receipt(message.id, f.own.viewerCookie, { status: 'dismissed', delivery_version: 1 }))
      .status
  ).toBe(404)
  expect((await rows(message.id, f.own.viewer))[0].dismissed_at ?? null).toBeNull()
})

it('an expiry chosen as a local day is delivered during that whole day and not after it', async () => {
  const today = formatDateInput(new Date())
  const yesterday = formatDateInput(new Date(Date.now() - 86_400_000))
  const current = await publish({ expires_at: localDateEndToISOString(today) })
  const past = await publish({ expires_at: localDateEndToISOString(yesterday) })
  expect(await mine(f.own.viewerCookie, current.id)).toBeTruthy()
  expect(await mine(f.own.viewerCookie, past.id)).toBeUndefined()
  const saved = await f.payload.findByID({
    collection: 'portal-messages',
    id: current.id,
    overrideAccess: true,
  })
  expect(new Date(saved.expires_at!).toISOString()).toBe(localDateEndToISOString(today))
  expect(formatDateInput(saved.expires_at!)).toBe(today)
})
