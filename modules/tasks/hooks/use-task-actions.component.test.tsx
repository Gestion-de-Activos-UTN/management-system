import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { componentFixture, deferred } from '../task-component-test-utils'
import { useTaskCommand, useEditTask } from './use-task-actions'
import { TaskCommandBusyError } from '../task-command-gate'

it('shares repeated commands before React renders pending state and sends one toast', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.post.mockReturnValue(response.promise)
  const { result } = renderHook(() => useTaskCommand('task-12'), { wrapper: f.Wrapper })
  let first!: Promise<unknown>, second!: Promise<unknown>
  act(() => {
    first = result.current.mutateAsync({ action: 'claim' })
    second = result.current.mutateAsync({ action: 'claim' })
  })
  expect(second).toBe(first)
  await waitFor(() => expect(f.post).toHaveBeenCalledTimes(1))
  await act(async () => {
    response.resolve({} as never)
    await first
  })
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tarea reclamada' }))
})

it('rejects a different command while the first one owns the gate', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.post.mockReturnValue(response.promise)
  const { result } = renderHook(() => useTaskCommand('task-12'), { wrapper: f.Wrapper })
  let first!: Promise<unknown>
  act(() => {
    first = result.current.mutateAsync({ action: 'complete' })
  })
  await act(async () => {
    await expect(result.current.mutateAsync({ action: 'release' })).rejects.toBeInstanceOf(
      TaskCommandBusyError
    )
  })
  expect(f.toast).not.toHaveBeenCalled()
  await act(async () => {
    response.resolve({} as never)
    await first
  })
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post).toHaveBeenCalledWith('/api/v1/tasks/task-12/complete', {})
})

for (const status of [403, 404, 409, 500]) {
  it(`${status}: reports one failure, invalidates task scopes and permits retry`, async () => {
    const f = componentFixture()
    const keys = [
      ['tasks', { view: 'mine', officeId: 'office-a' }],
      ['tasks', { view: 'all', officeId: 'office-b' }],
      ['tasks', 'task-12', 'visited-org'],
    ]
    keys.forEach(key => f.client.setQueryData(key, { status: 'in_progress' }))
    f.client.setQueryData(['assets'], ['unchanged'])
    f.post.mockRejectedValueOnce({
      status,
      code: status === 409 ? 'task_completed_by_admin' : 'unexpected',
      message: 'La tarea ya fue completada. Actualiza la vista.',
    })
    const { result } = renderHook(() => useTaskCommand('task-12'), { wrapper: f.Wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ action: 'complete' })).rejects.toMatchObject({
        status,
      })
    })
    expect(f.toast).toHaveBeenCalledTimes(1)
    expect(f.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No se pudo completar la tarea' })
    )
    for (const key of keys) expect(f.client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(f.client.getQueryState(['assets'])?.isInvalidated).toBe(false)
    f.post.mockResolvedValue({} as never)
    await act(async () => {
      await result.current.mutateAsync({ action: 'complete' })
    })
    expect(f.post).toHaveBeenCalledTimes(2)
    expect(f.toast).toHaveBeenCalledTimes(2)
  })
}

it('keeps the command locked until active queries finish refreshing after a stale rejection', async () => {
  const f = componentFixture()
  const refresh = deferred<{ status: string }>()
  f.client.setQueryDefaults(['tasks'], { queryFn: () => refresh.promise })
  const { QueryObserver } = await import('@tanstack/react-query')
  const observer = new QueryObserver(f.client, {
    queryKey: ['tasks', 'task-12'],
    initialData: { status: 'in_progress' },
    staleTime: Infinity,
  })
  const unsubscribe = observer.subscribe(() => {})
  try {
    f.post.mockRejectedValue({ status: 409, code: 'task_completed_by_admin' })
    const { result } = renderHook(() => useTaskCommand('task-12'), { wrapper: f.Wrapper })
    let outcome!: Promise<unknown>
    act(() => {
      outcome = result.current.mutateAsync({ action: 'complete' }).catch(e => e)
    })
    await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.isPending).toBe(true))
    await act(async () => {
      await expect(result.current.mutateAsync({ action: 'release' })).rejects.toBeInstanceOf(
        TaskCommandBusyError
      )
      refresh.resolve({ status: 'completed' })
      await outcome
    })
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.client.getQueryData(['tasks', 'task-12'])).toEqual({ status: 'completed' })
  } finally {
    unsubscribe()
  }
})

it('editing invalidates task queries and reports success only once for one save', async () => {
  const f = componentFixture()
  f.client.setQueryData(['tasks', 'task-12'], { title: 'Anterior' })
  f.patch.mockResolvedValue({ title: 'Actualizado' } as never)
  const { result } = renderHook(() => useEditTask('task-12'), { wrapper: f.Wrapper })
  await act(async () => {
    await result.current.mutateAsync({ title: 'Actualizado' })
  })
  expect(f.patch).toHaveBeenCalledWith('/api/v1/tasks/task-12', { title: 'Actualizado' })
  expect(f.client.getQueryState(['tasks', 'task-12'])?.isInvalidated).toBe(true)
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tarea actualizada' }))
})
