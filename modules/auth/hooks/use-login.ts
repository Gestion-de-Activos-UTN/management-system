'use client';

import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@/lib/http-client';
import { setSession, type Session } from '@/lib/session';
import { loginAdmin, loginUser } from '../service';

type Credentials = { email: string; password: string };

// Payload has no unified auth collection — admins and users are separate collections with
// separate login endpoints. One form tries admins first, then users; whichever succeeds
// decides the session's `collection`. Both endpoints return a generic "invalid credentials"
// on any failure (nonexistent email or wrong password), so trying both in sequence never
// leaks which collection matched.
export function useLogin() {
  return useMutation<NonNullable<Session>, HttpError, Credentials>({
    mutationFn: async ({ email, password }) => {
      try {
        const data = await loginAdmin(email, password);
        return { token: data.token, collection: 'admins' as const };
      } catch {
        const data = await loginUser(email, password);
        return { token: data.token, collection: 'users' as const };
      }
    },
    onSuccess: (session) => setSession(session),
  });
}
