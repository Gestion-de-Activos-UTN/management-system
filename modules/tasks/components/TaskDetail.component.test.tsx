import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { componentFixture, deferred, task } from '../task-component-test-utils'
import { TaskDetail } from './TaskDetail'
import { TaskEditForm } from './TaskEditForm'
import { useTask } from '../hooks/use-tasks'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

it('refreshes a stale task after administrative completion and removes obsolete buttons', async () => {
  const f = componentFixture()
  let server = task()
  const get = f.get.getMockImplementation()!
  f.get.mockImplementation(async (path, params) =>
    path === '/api/v1/tasks/task-12' ? (server as never) : get(path, params)
  )
  function Screen() {
    const query = useTask('task-12')
    return query.data ? <TaskDetail task={query.data} /> : <span>Cargando tarea</span>
  }
  render(<Screen />, { wrapper: f.Wrapper })
  const complete = await screen.findByRole('button', { name: 'Completar' })
  f.post.mockImplementation(async () => {
    server = task({ status: 'completed', effective_status: 'completed', available_actions: [] })
    throw {
      status: 409,
      code: 'task_completed_by_admin',
      message: 'La tarea ya fue completada por un administrador.',
    }
  })
  act(() => {
    fireEvent.click(complete)
    fireEvent.click(complete)
  })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Completar' })).toBeNull())
  expect(screen.queryByRole('button', { name: 'Liberar tarea' })).toBeNull()
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No se pudo completar la tarea',
      message: 'La tarea ya fue completada por un administrador. Revisa su actividad.',
    })
  )
  expect(f.client.getQueryData(['tasks', 'task-12', undefined])).toMatchObject({
    status: 'completed',
  })
})

it('deletion stays open after failure, prevents closing while pending and allows retry', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.remove.mockReturnValueOnce(response.promise)
  const user = userEvent.setup()
  push.mockClear()
  render(
    <TaskDetail
      task={task({ status: 'pending', effective_status: 'pending', available_actions: ['delete'] })}
    />,
    { wrapper: f.Wrapper }
  )
  await user.click(screen.getByRole('button', { name: 'Eliminar' }))
  await user.click(await screen.findByRole('button', { name: 'Eliminar tarea' }))
  await waitFor(() => expect(f.remove).toHaveBeenCalledTimes(1))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(
    true
  )
  await act(async () => response.reject({ status: 500 }))
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(push).not.toHaveBeenCalled()
  f.remove.mockResolvedValue({} as never)
  await user.click(screen.getByRole('button', { name: 'Eliminar tarea' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/portal/tasks'))
  expect(f.remove).toHaveBeenCalledTimes(2)
  expect(f.toast).toHaveBeenCalledTimes(2)
})

it('an edit with invalid fields does not send a PATCH or a notification', async () => {
  const f = componentFixture()
  const user = userEvent.setup()
  const saved = vi.fn()
  render(<TaskEditForm task={task()} onSaved={saved} />, { wrapper: f.Wrapper })
  await user.clear(screen.getByRole('textbox', { name: /Título/ }))
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await screen.findByText('Escribe un título.')
  expect(f.patch).not.toHaveBeenCalled()
  expect(f.toast).not.toHaveBeenCalled()
  expect(saved).not.toHaveBeenCalled()
})

it('successful deletion still navigates if query invalidation unmounts the detail', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.remove.mockReturnValue(response.promise)
  const user = userEvent.setup()
  push.mockClear()
  const view = render(
    <TaskDetail
      task={task({ status: 'pending', effective_status: 'pending', available_actions: ['delete'] })}
    />,
    { wrapper: f.Wrapper }
  )
  await user.click(screen.getByRole('button', { name: 'Eliminar' }))
  await user.click(await screen.findByRole('button', { name: 'Eliminar tarea' }))
  await waitFor(() => expect(f.remove).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => response.resolve({} as never))
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  expect(push).toHaveBeenCalledWith('/portal/tasks')
  expect(f.toast).toHaveBeenCalledTimes(1)
})

it('an edit keeps its values after failure and succeeds on retry', async () => {
  const f = componentFixture()
  f.patch.mockRejectedValueOnce({ status: 500 })
  const user = userEvent.setup()
  const saved = vi.fn()
  render(<TaskEditForm task={task()} onSaved={saved} />, { wrapper: f.Wrapper })
  const title = screen.getByRole('textbox', { name: /Título/ })
  await user.clear(title)
  await user.type(title, 'Título corregido')
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  expect((title as HTMLInputElement).value).toBe('Título corregido')
  expect(saved).not.toHaveBeenCalled()
  f.patch.mockResolvedValue({} as never)
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(f.patch).toHaveBeenCalledTimes(2)
  expect(f.toast).toHaveBeenCalledTimes(2)
})

it('repeated edit submissions before validation finishes must send only one PATCH', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.patch.mockReturnValue(response.promise)
  const saved = vi.fn()
  render(<TaskEditForm task={task()} onSaved={saved} />, { wrapper: f.Wrapper })
  const form = screen.getByRole('textbox', { name: /Título/ }).closest('form')!
  act(() => {
    for (let i = 0; i < 5; i++) fireEvent.submit(form)
  })
  await waitFor(() => expect(f.patch).toHaveBeenCalled())
  await act(async () => response.resolve({} as never))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(f.patch).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(saved).toHaveBeenCalledTimes(1)
})

it('a successful edit must stay locked until the parent finishes closing its modal', async () => {
  const f = componentFixture()
  f.patch.mockResolvedValue({} as never)
  const saved = vi.fn()
  render(<TaskEditForm task={task()} onSaved={saved} />, { wrapper: f.Wrapper })
  const form = screen.getByRole('textbox', { name: /Título/ }).closest('form')!
  fireEvent.submit(form)
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  fireEvent.submit(form)
  await act(async () => {})
  expect(f.patch).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(saved).toHaveBeenCalledTimes(1)
})
