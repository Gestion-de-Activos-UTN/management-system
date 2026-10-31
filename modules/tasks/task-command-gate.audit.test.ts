import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTaskCommandGate, TaskCommandBusyError } from './task-command-gate'

const unhandled = vi.fn()
beforeEach(() => {
  unhandled.mockClear()
  process.on('unhandledRejection', unhandled)
})
afterEach(() => {
  process.off('unhandledRejection', unhandled)
})
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred() {
  let resolve!: (value: string) => void, reject!: (error: Error) => void
  const promise = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

it('shares a repeated command and rejects a different one without touching the first', async () => {
  const run = createTaskCommandGate<'claim' | 'delete'>()
  const claim = deferred()
  const start = vi.fn(() => claim.promise)
  const first = run('claim', start)
  expect(run('claim', start)).toBe(first)
  const other = vi.fn(() => Promise.resolve('deleted'))
  await expect(run('delete', other)).rejects.toBeInstanceOf(TaskCommandBusyError)
  expect(other).not.toHaveBeenCalled()
  claim.resolve('claimed')
  expect(await first).toBe('claimed')
  expect(start).toHaveBeenCalledTimes(1)
})

it('releases after success and after failure', async () => {
  const run = createTaskCommandGate<'claim' | 'delete'>()
  await run('claim', () => Promise.resolve('ok'))
  await expect(run('delete', () => Promise.reject(new Error('api')))).rejects.toThrow('api')
  expect(await run('delete', () => Promise.resolve('again'))).toBe('again')
})

it('never leaves an unhandled rejection when callers ignore the result', async () => {
  const run = createTaskCommandGate<'claim' | 'delete'>()
  const claim = deferred()
  void run('claim', () => claim.promise)
  void run('delete', () => Promise.resolve('x'))
  claim.reject(new Error('api failed, nobody listening'))
  await flush()
  expect(unhandled).not.toHaveBeenCalled()
})
