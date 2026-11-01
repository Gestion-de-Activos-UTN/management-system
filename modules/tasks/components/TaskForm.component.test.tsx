import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TaskForm } from './TaskForm'
import { CreateRelatedTaskButton } from './CreateRelatedTaskButton'
import {
  componentFixture,
  deferred,
  officeId,
  otherOfficeId,
  referenceId,
} from '../task-component-test-utils'

vi.mock('@/lib/use-session', () => ({ useSession: () => ({ userId: 'admin-test' }) }))

async function form() {
  const f = componentFixture()
  const saved = vi.fn()
  const view = render(
    <TaskForm initialReference={{ relationTo: 'assets', value: referenceId }} onSaved={saved} />,
    { wrapper: f.Wrapper }
  )
  const title = await screen.findByRole('textbox', { name: /Título/ })
  await screen.findByText('Servidor contable')
  const user = userEvent.setup()
  await user.type(title, 'Tarea de regresión')
  return { ...f, ...view, saved, title, user, form: title.closest('form')! }
}

function submitMany(element: HTMLFormElement) {
  // Dispatch in one turn: React cannot render pending state between these submissions.
  act(() => {
    for (let i = 0; i < 5; i++) fireEvent.submit(element)
  })
}

it('blocks repeated submits before validation and throughout the request; reports one success', async () => {
  const f = await form()
  const response = deferred<never>()
  f.post.mockReturnValue(response.promise)
  submitMany(f.form)
  await waitFor(() => expect(f.post).toHaveBeenCalledTimes(1))
  submitMany(f.form)
  expect(f.saved).not.toHaveBeenCalled()
  expect(f.toast).not.toHaveBeenCalled()
  expect(f.post).toHaveBeenCalledWith(
    '/api/v1/tasks',
    expect.objectContaining({
      title: 'Tarea de regresión',
      office_ids: [officeId],
      global: false,
      related_entity: { relationTo: 'assets', value: referenceId },
    })
  )
  await act(async () => response.resolve({ docs: [{ id: 'created' }], totalDocs: 1 } as never))
  await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tarea creada' }))
})

it('keeps the successful form locked while its parent is still closing the modal', async () => {
  const f = await form()
  f.post.mockResolvedValue({ docs: [], totalDocs: 1 } as never)
  submitMany(f.form)
  await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
  // Keep the successful child mounted to exercise the exit interval deterministically.
  submitMany(f.form)
  await act(async () => {})
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Crear tarea' }) as HTMLButtonElement).disabled).toBe(
    true
  )
})

it('shows invalid fields inline without a request or toast and unlocks after correction', async () => {
  const f = await form()
  await f.user.clear(f.title)
  submitMany(f.form)
  await screen.findByText('Escribe un título.')
  expect(f.post).not.toHaveBeenCalled()
  expect(f.toast).not.toHaveBeenCalled()
  await f.user.type(f.title, 'Título corregido')
  f.post.mockResolvedValue({ docs: [], totalDocs: 1 } as never)
  await f.user.click(screen.getByRole('button', { name: 'Crear tarea' }))
  await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
  expect(f.post).toHaveBeenCalledTimes(1)
})

it('retains entered values after a network failure and allows one corrected retry', async () => {
  const f = await form()
  const response = deferred<never>()
  f.post.mockReturnValueOnce(response.promise)
  submitMany(f.form)
  await waitFor(() => expect(f.post).toHaveBeenCalledTimes(1))
  await act(async () => response.reject(new TypeError('Failed to fetch')))
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  expect(f.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No se pudo crear la tarea',
      message: expect.stringContaining('Revisa tu conexión'),
    })
  )
  expect((f.title as HTMLInputElement).value).toBe('Tarea de regresión')
  expect(f.saved).not.toHaveBeenCalled()
  f.post.mockResolvedValue({ docs: [], totalDocs: 1 } as never)
  submitMany(f.form)
  await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
  expect(f.post).toHaveBeenCalledTimes(2)
  expect(f.toast).toHaveBeenCalledTimes(2)
  // The first request may have been saved: the retry repeats its key so the server returns it.
  const [first, retry] = f.post.mock.calls.map(([, body]) => (body as any).operation_id)
  expect(first).toMatch(/^[0-9a-f]{32}$/)
  expect(retry).toBe(first)
})

it('a key conflict after a lost response refreshes the list and closes without another request', async () => {
  const f = await form()
  const invalidate = vi.spyOn(f.client, 'invalidateQueries')
  f.post.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  submitMany(f.form)
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  // The user edits the form before retrying: the server already saved the first attempt.
  await f.user.type(f.title, ' corregida')
  f.post.mockRejectedValueOnce({
    status: 409,
    code: 'task_operation_conflict',
    message: 'Esta creación ya se guardó con otros datos.',
  })
  submitMany(f.form)
  await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  expect(f.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'La tarea ya estaba creada' })
  )
  const [first, retry] = f.post.mock.calls.map(([, body]) => (body as any).operation_id)
  expect(retry).toBe(first)
  submitMany(f.form)
  await act(async () => {})
  expect(f.post).toHaveBeenCalledTimes(2)
})

it('each opened form sends its own operation key', async () => {
  const keys: string[] = []
  for (let i = 0; i < 2; i++) {
    const f = await form()
    f.post.mockResolvedValue({ docs: [], totalDocs: 1 } as never)
    submitMany(f.form)
    await waitFor(() => expect(f.saved).toHaveBeenCalledTimes(1))
    keys.push((f.post.mock.lastCall![1] as any).operation_id)
    f.unmount()
  }
  expect(keys[0]).toMatch(/^[0-9a-f]{32}$/)
  expect(keys[1]).not.toBe(keys[0])
})

it('creates independent office tasks in one request and emits one notification', async () => {
  const f = componentFixture()
  const saved = vi.fn()
  const user = userEvent.setup()
  render(<TaskForm onSaved={saved} />, { wrapper: f.Wrapper })
  await waitFor(() => expect(f.client.getQueryData(['offices', undefined])).toHaveLength(2))
  await user.type(screen.getByRole('textbox', { name: /Título/ }), 'Revisar oficinas')
  await user.click(screen.getByRole('textbox', { name: /Oficinas/ }))
  await user.keyboard('{ArrowDown}{Enter}')
  f.post.mockResolvedValue({ docs: [{ id: 'one' }, { id: 'two' }], totalDocs: 2 } as never)
  await user.click(screen.getByRole('button', { name: 'Crear 2 tareas' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post).toHaveBeenCalledWith(
    '/api/v1/tasks',
    expect.objectContaining({
      office_ids: [officeId, otherOfficeId],
      global: false,
    })
  )
  expect(f.toast).toHaveBeenCalledTimes(1)
})

it('closing and reopening a related-task modal resets the title and uses the current reference', async () => {
  const f = componentFixture()
  const user = userEvent.setup()
  const nextReference = '44444444-4444-4444-8444-444444444444'
  const view = render(
    <CreateRelatedTaskButton reference={{ relationTo: 'assets', value: referenceId }} />,
    { wrapper: f.Wrapper }
  )
  await user.click(await screen.findByRole('button', { name: 'Crear tarea' }))
  await user.type(await screen.findByRole('textbox', { name: /Título/ }), 'Borrador anterior')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('textbox', { name: /Título/ })).toBeNull())
  view.rerender(
    <CreateRelatedTaskButton reference={{ relationTo: 'assets', value: nextReference }} />
  )
  const original = f.get.getMockImplementation()!
  f.get.mockImplementation(async (path, params) =>
    path === '/api/v1/tasks/reference-options'
      ? ({
          docs: [
            {
              relationTo: 'assets',
              value: nextReference,
              label: 'Nuevo servidor',
              office_id: officeId,
            },
          ],
        } as never)
      : original(path, params)
  )
  await user.click(screen.getByRole('button', { name: 'Crear tarea' }))
  const title = await screen.findByRole('textbox', { name: /Título/ })
  expect((title as HTMLInputElement).value).toBe('')
  await screen.findByText('Nuevo servidor')
  await user.type(title, 'Tarea nueva')
  f.post.mockResolvedValue({ docs: [], totalDocs: 1 } as never)
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crear tarea' }))
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  expect(f.post).toHaveBeenCalledWith(
    '/api/v1/tasks',
    expect.objectContaining({
      related_entity: { relationTo: 'assets', value: nextReference },
      title: 'Tarea nueva',
    })
  )
})

it('an entity that became unavailable is reported under its field, without a toast', async () => {
  const f = await form()
  f.post.mockRejectedValueOnce({
    status: 409,
    code: 'asset_unavailable',
    message: 'No se pueden crear tareas para un activo retirado o eliminado.',
  })
  submitMany(f.form)
  // The entity is fixed by the caller here: there is nothing else to select.
  expect(
    await screen.findByText('Este activo está retirado o eliminado y ya no admite tareas nuevas.')
  ).toBeTruthy()
  expect(f.toast).not.toHaveBeenCalled()
  expect(f.saved).not.toHaveBeenCalled()
})

it('searches related entities on the server and shows the chosen one by id', async () => {
  const f = componentFixture()
  const user = userEvent.setup()
  render(<TaskForm initialReference={{ relationTo: 'assets' }} referenceEditable />, {
    wrapper: f.Wrapper,
  })
  const searches = () =>
    f.get.mock.calls
      .filter(([path]) => path === '/api/v1/tasks/reference-options')
      .map(([, params]) => (params as { q?: string; id?: string }) ?? {})
  const input = await screen.findByPlaceholderText('Selecciona una entidad')
  await user.type(input, 'servidor')
  await waitFor(() => expect(searches().some(params => params.q === 'servidor')).toBe(true))
  await user.click(await screen.findByRole('option', { name: 'Servidor contable', hidden: true }))
  // The chosen entity is requested by id; its label copied into the input is not a new search.
  await waitFor(() => expect(searches().some(params => params.id === referenceId)).toBe(true))
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(searches().some(params => params.q === 'Servidor contable')).toBe(false)
  expect((input as HTMLInputElement).value).toBe('Servidor contable')
})
