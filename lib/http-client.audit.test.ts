import { afterEach, expect, it, vi } from 'vitest'
import { notifications } from '@mantine/notifications'
import { httpClient } from './http-client'
import { showApiError } from './notify-error'

vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('shows the plan limit when a member reactivation is rejected by the API', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: 'user_limit_reached',
          message: 'Tu plan permite hasta 4 personas con el rol Viewer.',
        },
        { status: 409 }
      )
    )
  )

  const error = await httpClient
    .patch('/api/v1/org-members/member-id', { is_active: true })
    .catch(error => error)
  expect(error).toMatchObject({ status: 409, code: 'user_limit_reached' })

  const action = 'No se pudo reactivar a la persona'
  showApiError(error, action, action)
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({
      color: 'orange',
      title: action,
      message: 'Alcanzaste el límite de personas activas para este rol en tu plan.',
    })
  )
})

it('continues normalizing Payload errors without replacing their name', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { errors: [{ name: 'ValidationError', message: 'El campo nombre es obligatorio.' }] },
          { status: 400 }
        )
      )
  )
  await expect(httpClient.patch('/api/v1/org-members/member-id', {})).rejects.toEqual({
    status: 400,
    code: 'ValidationError',
    message: 'El campo nombre es obligatorio.',
  })
})

it('keeps unknown technical messages out of the notification', () => {
  showApiError(
    { status: 500, code: 'request_failed', message: 'database connection details' },
    'No se pudo reactivar a la persona'
  )
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Ocurrió un error',
      message: 'No se pudo reactivar a la persona',
      autoClose: false,
    })
  )
})
