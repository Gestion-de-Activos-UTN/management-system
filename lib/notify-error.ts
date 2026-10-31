import { notify } from './notify'
import type { HttpError } from './http-client'
import { userFacingErrorMessage } from './user-facing-error'

// Los rechazos de la API incluyen permisos, cupos y conflictos, además de validación.
// Los fallos inesperados permanecen visibles hasta que la persona los cierre.
export function showApiError(error: unknown, fallback: string, title?: string) {
  const status = (error as Partial<HttpError> | undefined)?.status
  const isValidation = typeof status === 'number' && status >= 400 && status < 500
  const isNetworkError =
    error instanceof TypeError && /fetch|network|load failed/i.test(error.message)
  const generalMessage = isNetworkError
    ? 'No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.'
    : status === 401
      ? 'Tu sesión venció. Inicia sesión nuevamente.'
      : status === 403
        ? 'No tienes permiso para realizar esta acción.'
        : status === 404
          ? 'El elemento ya no está disponible. Actualiza la página.'
          : status === 429
            ? 'Hay demasiados intentos. Espera unos momentos y vuelve a intentar.'
            : typeof status === 'number' && status >= 500
              ? 'Ocurrió un problema en el servidor. Intenta nuevamente en unos momentos.'
              : fallback
  const message = userFacingErrorMessage(error, generalMessage)

  const heading = title ?? fallback
  notify({
    color: isValidation ? 'orange' : 'red',
    title: heading,
    message: message === heading ? undefined : message,
    autoClose: isValidation ? 5000 : false,
  })
}
