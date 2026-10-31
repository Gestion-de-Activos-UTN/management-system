import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { scopeFixture, type ScopeFixture } from './tenant-scope-test-utils'

let f: ScopeFixture
const key = () => randomBytes(16).toString('hex')
function body(extra: Record<string, unknown> = {}) {
  return {
    title: 'Revisar respaldo',
    description: 'Comprobar el último respaldo.',
    priority: 'normal',
    global: false,
    office_ids: [f.own.office],
    assignment_kind: 'open_pool',
    ...extra,
  }
}
const create = (input: Record<string, unknown>, cookie = f.own.adminCookie) =>
  f.api('/v1/tasks', cookie, 'POST', input)
const ids = (result: { data: { docs: Array<{ id: string }> } }) =>
  result.data.docs.map(task => task.id).sort()
async function tasks(operation?: string) {
  return (
    await f.payload.find({
      collection: 'tasks',
      overrideAccess: true,
      showHiddenFields: true,
      depth: 0,
      pagination: false,
      where: operation ? { operation_id: { equals: operation } } : {},
    })
  ).docs
}

beforeAll(async () => {
  f = await scopeFixture('operations')
}, 60000)
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  if (f) await f.payload.destroy()
})

it('a retry with the same key after a saved creation returns the same tasks without creating more', async () => {
  const operation = key()
  const input = body({ office_ids: [f.own.office, f.own.second], operation_id: operation })
  const first = await create(input)
  expect(first.status, JSON.stringify(first.data)).toBe(201)
  expect(first.data.totalDocs).toBe(2)
  const before = await f.versions()
  const retry = await create(input)
  expect(retry.status).toBe(201)
  expect(retry.data.totalDocs).toBe(2)
  expect(ids(retry)).toEqual(ids(first))
  expect(await f.versions()).toEqual(before)
  expect(await tasks(operation)).toHaveLength(2)
})

it('simultaneous attempts with one key create the tasks once and all answer with them', async () => {
  const operation = key()
  const input = body({ operation_id: operation })
  const results = await Promise.all(Array.from({ length: 5 }, () => create(input)))
  expect(results.map(result => result.status)).toEqual(Array(5).fill(201))
  const saved = await tasks(operation)
  expect(saved).toHaveLength(1)
  for (const result of results) expect(ids(result)).toEqual([String(saved[0].id)])
})

it('a key reused with different data is rejected without writing', async () => {
  const operation = key()
  expect((await create(body({ operation_id: operation }))).status).toBe(201)
  const before = await f.versions()
  const changed = await create(body({ operation_id: operation, title: 'Otro título' }))
  expect(changed.status).toBe(409)
  expect(changed.data.error).toBe('task_operation_conflict')
  expect(await f.versions()).toEqual(before)
})

it('another person cannot replay a key, read its tasks or block its own creation', async () => {
  const operation = key()
  const original = await create(body({ operation_id: operation, title: 'Tarea privada' }))
  expect(original.status).toBe(201)
  const before = await f.versions()
  const replay = await create(
    body({ operation_id: operation, title: 'Tarea privada' }),
    f.own.managerCookie
  )
  expect(replay.status).toBe(409)
  expect(JSON.stringify(replay.data)).not.toContain(original.data.docs[0].id)
  expect(await f.versions()).toEqual(before)
  const foreign = await create(
    body({ operation_id: operation, office_ids: [f.foreign.office] }),
    f.foreign.adminCookie
  )
  expect(foreign.status).toBe(201)
  expect(ids(foreign)).not.toEqual(ids(original))
})

it('identical tasks created on purpose are kept: without a key or with a new one', async () => {
  const input = body({ title: 'Tarea repetida a propósito' })
  const results = [
    await create(input),
    await create(input),
    await create({ ...input, operation_id: key() }),
    await create({ ...input, operation_id: key() }),
  ]
  expect(results.map(result => result.status)).toEqual([201, 201, 201, 201])
  expect(new Set(results.flatMap(ids)).size).toBe(4)
})

it('a failure after writing the first task rolls back the whole creation and the retry creates it once', async () => {
  const operation = key()
  const input = body({ office_ids: [f.own.office, f.own.second], operation_id: operation })
  const original = f.payload.create.bind(f.payload)
  let created = 0
  vi.spyOn(f.payload, 'create').mockImplementation((async (args: any) => {
    if (args.collection === 'tasks' && ++created === 2) throw new Error('fallo controlado')
    return original(args)
  }) as never)
  const before = await f.versions()
  const failed = await create(input)
  expect(failed.status).toBe(500)
  expect(JSON.stringify(failed.data)).not.toContain('fallo controlado')
  expect(await f.versions()).toEqual(before)
  vi.restoreAllMocks()
  const retry = await create(input)
  expect(retry.status).toBe(201)
  expect(retry.data.totalDocs).toBe(2)
  expect(await tasks(operation)).toHaveLength(2)
  expect(ids(await create(input))).toEqual(ids(retry))
})

it('responses never expose the operation key or its fingerprint', async () => {
  const operation = key()
  const input = body({ operation_id: operation })
  const first = await create(input)
  const retry = await create(input)
  const detail = await f.api(`/v1/tasks/${first.data.docs[0].id}`, f.own.adminCookie)
  const list = await f.api('/v1/tasks', f.own.adminCookie)
  expect(detail.status).toBe(200)
  for (const response of [first, retry, detail, list]) {
    expect(JSON.stringify(response.data)).not.toContain(operation)
    expect(JSON.stringify(response.data)).not.toContain('operation_fingerprint')
  }
})

it('an invalid key is rejected before any write', async () => {
  const before = await f.versions()
  for (const operation_id of ['corta', 'x'.repeat(65), 'clave con espacios 1234', 42])
    expect((await create(body({ operation_id }))).status).toBe(400)
  expect(await f.versions()).toEqual(before)
})

it('repeated task commands are rejected with 409 and never repeat their effects', async () => {
  const created = await create(body())
  const id = created.data.docs[0].id
  const command = (action: string, cookie = f.own.viewerCookie, input?: unknown) =>
    f.api(`/v1/tasks/${id}/${action}`, cookie, 'POST', input)
  const saved = () =>
    f.payload.findByID({ collection: 'tasks', id, overrideAccess: true, depth: 0 })
  expect((await command('claim')).status).toBe(200)
  let before = await saved()
  const claimAgain = await command('claim')
  expect(claimAgain.status).toBe(409)
  expect(await saved()).toEqual(before)
  expect((await command('complete')).status).toBe(200)
  before = await saved()
  for (const [action, cookie, input] of [
    ['complete', f.own.viewerCookie, undefined],
    ['claim', f.own.viewerCookie, undefined],
    ['release', f.own.viewerCookie, undefined],
    ['cancel', f.own.adminCookie, { reason: 'Ya no corresponde.' }],
  ] as const) {
    const result = await command(action, cookie, input)
    expect(result.status, `${action}: ${JSON.stringify(result.data)}`).toBe(409)
  }
  expect(await saved()).toEqual(before)
})
