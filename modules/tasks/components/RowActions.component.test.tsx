import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { componentFixture, deferred, task } from '../task-component-test-utils'
import { RowActions } from './RowActions'

it('edits from the table with one save and toast, then closes and invalidates task queries', async () => {
  const f = componentFixture()
  const response = deferred<never>()
  f.patch.mockReturnValue(response.promise)
  f.client.setQueryData(['tasks', { view: 'all' }], [task()])
  const user = userEvent.setup()
  render(<RowActions task={task({ available_actions: ['edit', 'reassign', 'cancel'] })} />, {
    wrapper: f.Wrapper,
  })
  expect(screen.queryByRole('button', { name: 'Reasignar' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Editar tarea' }))
  const dialog = await screen.findByRole('dialog')
  const title = within(dialog).getByRole('textbox', { name: /Título/ })
  expect((title as HTMLInputElement).value).toBe('Tarea de prueba')
  await user.clear(title)
  await user.type(title, 'Actualizada desde la tabla')
  act(() => {
    for (let i = 0; i < 5; i++) fireEvent.submit(title.closest('form')!)
  })
  await waitFor(() => expect(f.patch).toHaveBeenCalledTimes(1))
  expect(f.patch).toHaveBeenCalledWith(
    '/api/v1/tasks/task-12',
    expect.objectContaining({
      title: 'Actualizada desde la tabla',
    })
  )
  await act(async () => response.resolve({} as never))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.toast).toHaveBeenCalledTimes(1)
  expect(f.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Tarea actualizada' }))
  expect(f.client.getQueryState(['tasks', { view: 'all' }])?.isInvalidated).toBe(true)
})

it('does not offer editing when the server has not authorized that action', () => {
  const f = componentFixture()
  render(<RowActions task={task({ available_actions: ['claim'] })} />, { wrapper: f.Wrapper })
  expect(screen.queryByRole('button', { name: 'Editar tarea' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Reclamar' })).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('discards a closed draft and takes the latest row values when reopened', async () => {
  const f = componentFixture()
  const user = userEvent.setup()
  const view = render(<RowActions task={task({ available_actions: ['edit'] })} />, {
    wrapper: f.Wrapper,
  })
  await user.click(screen.getByRole('button', { name: 'Editar tarea' }))
  const title = await screen.findByRole('textbox', { name: /Título/ })
  await user.clear(title)
  await user.type(title, 'Borrador sin guardar')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  view.rerender(
    <RowActions task={task({ title: 'Título vigente', available_actions: ['edit'] })} />
  )
  await user.click(screen.getByRole('button', { name: 'Editar tarea' }))
  expect(((await screen.findByRole('textbox', { name: /Título/ })) as HTMLInputElement).value).toBe(
    'Título vigente'
  )
  expect(f.patch).not.toHaveBeenCalled()
})

it('retains the table edit after a failure and allows a successful retry', async () => {
  const f = componentFixture()
  f.patch.mockRejectedValueOnce({ status: 500 })
  const user = userEvent.setup()
  render(<RowActions task={task({ available_actions: ['edit'] })} />, { wrapper: f.Wrapper })
  await user.click(screen.getByRole('button', { name: 'Editar tarea' }))
  const title = await screen.findByRole('textbox', { name: /Título/ })
  await user.clear(title)
  await user.type(title, 'Cambio conservado')
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(f.toast).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((title as HTMLInputElement).value).toBe('Cambio conservado')
  f.patch.mockResolvedValue({} as never)
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(f.patch).toHaveBeenCalledTimes(2)
  expect(f.toast).toHaveBeenCalledTimes(2)
})
