'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import type { HttpError } from '@/lib/http-client'
import { setSession, type Session } from '@/lib/session'
import { resetPortalMessageSessionState } from '@/modules/portal-messages/session-state'
import { loginAdmin, loginUser } from '../service'

type Credentials = { email: string; password: string }
type LoginResult = { session: NonNullable<Session>; name: string | null }

// Payload responde en inglés y sin un código propio: se traduce por status. El 403 sólo llega
// con la contraseña correcta (prepareAccountLogin corre después de validarla), así que decir
// "desactivada" no revela a terceros qué correos existen.
export function loginErrorMessage(error: HttpError): string {
  if (error.status === 403)
    return 'Tu cuenta está desactivada. Pide a quien administra tu organización que la reactive.'
  if (/locked/i.test(error.message))
    return 'La cuenta quedó bloqueada por demasiados intentos. Prueba de nuevo en unos minutos.'
  if (error.status === 401) return 'El correo o la contraseña no son correctos.'
  return 'No se pudo iniciar sesión. Prueba de nuevo.'
}

const isHttpError = (error: unknown): error is HttpError =>
  typeof error === 'object' && error !== null && 'status' in error

// Payload has no unified auth collection — admins and users are separate collections with
// separate login endpoints. One form tries admins first, then users; whichever succeeds
// decides the session's `collection`. Both endpoints return a generic "invalid credentials"
// on any failure (nonexistent email or wrong password), so trying both in sequence never
// leaks which collection matched. A deactivated admin (403) stops there: falling through to
// users would hide it behind "wrong password".
// The response body's `token` is ignored — Payload already set it as the httpOnly
// `payload-token` cookie (lib/http-client.ts sends credentials: 'include'); tracking
// `collection` here is just to know which login succeeded.
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation<LoginResult, HttpError, Credentials>({
    mutationFn: async ({ email, password }) => {
      try {
        try {
          const { user } = await loginAdmin(email, password)
          return { session: { collection: 'admins' as const }, name: user?.name ?? null }
        } catch (error) {
          if (isHttpError(error) && error.status === 403) throw error
          const { user } = await loginUser(email, password)
          return { session: { collection: 'users' as const }, name: user?.name ?? null }
        }
      } catch (error) {
        if (!isHttpError(error)) throw error
        throw { ...error, message: loginErrorMessage(error) } satisfies HttpError
      }
    },
    // Los errores se muestran dentro del formulario (app/(dashboard)/login/page.tsx), no como
    // toast. El de éxito confirma con qué cuenta se entró: sólo acá, nunca al recargar.
    onSuccess: ({ session, name }) => {
      // Query keys (['tenant-context', asOrganization], assets/offices/organizations lists,
      // ...) don't include the user's identity, so a stale, still-non-stale-by-staleTime
      // cache entry from whoever was logged in before would otherwise render first for the
      // new account until an unrelated refetch happened to correct it.
      queryClient.clear()
      resetPortalMessageSessionState()
      setSession(session)
      notifications.show({
        color: 'green',
        message: name ? `Te damos la bienvenida, ${name}` : 'Te damos la bienvenida',
        autoClose: 3000,
      })
    },
  })
}
