import { notifications } from '@mantine/notifications'
import type { HttpError } from './http-client'

// A 4xx is the user's own input (missing field, bad value) — they can read it and
// move on, a brief toast is enough. A 5xx or a thrown non-HttpError (network down,
// unexpected exception) is not something the user caused or can immediately fix by
// re-reading the form, so it stays on screen until they dismiss it — auto-closing it
// after a few seconds risks it going unnoticed if they'd looked away.
export function showApiError(error: unknown, fallback: string) {
  const status = (error as Partial<HttpError> | undefined)?.status
  const isValidation = typeof status === 'number' && status >= 400 && status < 500
  const message = (error as Partial<HttpError> | undefined)?.message || fallback

  notifications.show({
    color: isValidation ? 'orange' : 'red',
    title: isValidation ? undefined : 'Something went wrong',
    message,
    autoClose: isValidation ? 5000 : false,
  })
}
