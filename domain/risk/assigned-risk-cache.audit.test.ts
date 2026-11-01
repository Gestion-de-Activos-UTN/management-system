import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAssignedRiskCache } from './assigned-risk-cache'

let clock = 0
const now = () => clock
const unhandled = vi.fn()
beforeEach(() => {
  clock = 0
  unhandled.mockClear()
  process.on('unhandledRejection', unhandled)
})
afterEach(() => {
  process.off('unhandledRejection', unhandled)
})
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

it('reuses the result while the token is unchanged and recalculates when it changes', async () => {
  const cache = createAssignedRiskCache<number>({ now })
  const compute = vi.fn(async () => compute.mock.calls.length)
  expect(await cache.get('k', 't1', compute)).toBe(1)
  expect(await cache.get('k', 't1', compute)).toBe(1)
  expect(await cache.get('k', 't2', compute)).toBe(2)
  expect(compute).toHaveBeenCalledTimes(2)
})

it('expires entries at the TTL boundary', async () => {
  const cache = createAssignedRiskCache<string>({ now, ttlMs: 60_000 })
  const compute = vi.fn(async () => 'x')
  await cache.get('k', 't', compute)
  clock = 59_999
  await cache.get('k', 't', compute)
  expect(compute).toHaveBeenCalledTimes(1)
  clock = 60_000
  await cache.get('k', 't', compute)
  expect(compute).toHaveBeenCalledTimes(2)
})

it('keeps scopes apart and shares one calculation between concurrent callers', async () => {
  const cache = createAssignedRiskCache<string>({ now })
  const compute = vi.fn(async () => 'x')
  const first = cache.get('org|a', 't', compute)
  const second = cache.get('org|a', 't', compute)
  expect(second).toBe(first)
  await cache.get('org|b', 't', compute)
  expect(compute).toHaveBeenCalledTimes(2)
})

it('never keeps a failure and leaves no unhandled rejection', async () => {
  const cache = createAssignedRiskCache<string>({ now })
  const failing = vi.fn(async () => {
    throw new Error('boom')
  })
  await expect(cache.get('k', 't', failing)).rejects.toThrow('boom')
  await flush()
  expect(cache.size()).toBe(0)
  const ok = vi.fn(async () => 'ok')
  expect(await cache.get('k', 't', ok)).toBe('ok')
  expect(ok).toHaveBeenCalledTimes(1)
  expect(unhandled).not.toHaveBeenCalled()
})

it('an older failure does not remove a newer entry for the same key', async () => {
  const cache = createAssignedRiskCache<string>({ now })
  let rejectOld!: (error: Error) => void
  const old = cache.get(
    'k',
    't1',
    () => new Promise<string>((_resolve, reject) => (rejectOld = reject))
  )
  const fresh = vi.fn(async () => 'fresh')
  await cache.get('k', 't2', fresh)
  rejectOld(new Error('late'))
  await expect(old).rejects.toThrow('late')
  await flush()
  expect(await cache.get('k', 't2', fresh)).toBe('fresh')
  expect(fresh).toHaveBeenCalledTimes(1)
  expect(unhandled).not.toHaveBeenCalled()
})

it('caps the cache at 100 entries and evicts the oldest insertion', async () => {
  const cache = createAssignedRiskCache<number>({ now, maxEntries: 100 })
  const compute = vi.fn(async () => 1)
  for (let index = 0; index <= 100; index++) await cache.get(`k${index}`, 't', compute)
  expect(cache.size()).toBe(100)
  expect(compute).toHaveBeenCalledTimes(101)
  await cache.get('k1', 't', compute)
  expect(compute).toHaveBeenCalledTimes(101)
  await cache.get('k0', 't', compute)
  expect(compute).toHaveBeenCalledTimes(102)
})

it('moves a recalculated key to the end of the eviction order', async () => {
  const cache = createAssignedRiskCache<number>({ now, maxEntries: 2 })
  const compute = vi.fn(async () => 1)
  await cache.get('a', 't', compute)
  await cache.get('b', 't', compute)
  await cache.get('a', 't2', compute) // recalculated: order is now b, a
  await cache.get('c', 't', compute) // evicts b
  expect(cache.size()).toBe(2)
  compute.mockClear()
  await cache.get('a', 't2', compute)
  await cache.get('c', 't', compute)
  expect(compute).not.toHaveBeenCalled()
  await cache.get('b', 't', compute)
  expect(compute).toHaveBeenCalledTimes(1)
})
