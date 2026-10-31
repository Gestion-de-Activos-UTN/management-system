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
      title: 'No se pudo reactivar a la persona',
      message: 'Ocurrió un problema en el servidor. Intenta nuevamente en unos momentos.',
      autoClose: false,
    })
  )
})

it('shows an actionable duplicate email message instead of technical server text', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: 'email_unavailable', message: 'duplicate key users_email_idx' },
          { status: 409 }
        )
      )
  )
  const error = await httpClient.post('/api/v1/org-members', {}).catch(error => error)
  expect(error).toMatchObject({ status: 409, code: 'email_unavailable' })
  showApiError(error, 'No se pudo crear la persona')
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No se pudo crear la persona',
      message: 'Ese correo ya está asociado a una cuenta. Escribe otro correo.',
    })
  )
})

it('keeps the action title for validation errors without duplicating its description', () => {
  showApiError({ status: 400 }, 'No se pudo guardar el cambio')
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'No se pudo guardar el cambio', message: null })
  )
})

it.each([
  [401, 'Tu sesión venció. Inicia sesión nuevamente.'],
  [403, 'No tienes permiso para realizar esta acción.'],
  [404, 'El elemento ya no está disponible. Actualiza la página.'],
  [429, 'Hay demasiados intentos. Espera unos momentos y vuelve a intentar.'],
])('explains HTTP %s when the API only returns an unknown code', (status, message) => {
  showApiError(
    { status, code: 'request_failed', message: 'technical details' },
    'No se pudo guardar el cambio'
  )
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'No se pudo guardar el cambio', message })
  )
})

it('explains a network failure without exposing the browser error', () => {
  showApiError(new TypeError('Failed to fetch'), 'No se pudo guardar el cambio')
  expect(notifications.show).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No se pudo guardar el cambio',
      message: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.',
      autoClose: false,
    })
  )
})
