import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSingleSubmission } from './use-single-submission'

function pending() {
  let finish!: () => void
  const promise = new Promise<void>(resolve => (finish = resolve))
  return { promise, finish }
}

it('ignores repeated runs while one is in flight and reopens after a failure', async () => {
  const { result } = renderHook(() => useSingleSubmission())
  const first = pending()
  const attempt = vi.fn(() => first.promise)
  let running!: Promise<void>
  act(() => {
    running = result.current.run(attempt)
    void result.current.run(attempt)
  })
  expect(attempt).toHaveBeenCalledTimes(1)
  await act(async () => {
    first.finish()
    await running
  })
  // No succeed(): a validation error or a failed request leaves the form available.
  await act(() => result.current.run(attempt))
  expect(attempt).toHaveBeenCalledTimes(2)
  expect(result.current.submitted).toBe(false)
})

it('stays locked after success until reset', async () => {
  const { result } = renderHook(() => useSingleSubmission())
  const attempt = vi.fn(async () => result.current.succeed())
  await act(() => result.current.run(attempt))
  expect(result.current.submitted).toBe(true)
  await act(() => result.current.run(attempt))
  expect(attempt).toHaveBeenCalledTimes(1)
  act(() => result.current.reset())
  expect(result.current.submitted).toBe(false)
  await act(() => result.current.run(attempt))
  expect(attempt).toHaveBeenCalledTimes(2)
})

it('a throwing attempt releases the lock', async () => {
  const { result } = renderHook(() => useSingleSubmission())
  await act(() => result.current.run(async () => Promise.reject(new Error('x'))).catch(() => {}))
  const attempt = vi.fn(async () => {})
  await act(() => result.current.run(attempt))
  expect(attempt).toHaveBeenCalledTimes(1)
})
