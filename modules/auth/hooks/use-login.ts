'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpError } from '@/lib/http-client';
import { setSession, type Session } from '@/lib/session';
import { loginAdmin, loginUser } from '../service';

type Credentials = { email: string; password: string };

// Payload has no unified auth collection — admins and users are separate collections with
// separate login endpoints. One form tries admins first, then users; whichever succeeds
// decides the session's `collection`. Both endpoints return a generic "invalid credentials"
// on any failure (nonexistent email or wrong password), so trying both in sequence never
// leaks which collection matched.
// The response body's `token` is ignored — Payload already set it as the httpOnly
// `payload-token` cookie (lib/http-client.ts sends credentials: 'include'); tracking
// `collection` here is just to know which login succeeded.
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation<NonNullable<Session>, HttpError, Credentials>({
    mutationFn: async ({ email, password }) => {
      try {
        await loginAdmin(email, password);
        return { collection: 'admins' as const };
      } catch {
        await loginUser(email, password);
        return { collection: 'users' as const };
      }
    },
    onSuccess: (session) => {
      // Query keys (['tenant-context', asOrganization], assets/offices/organizations lists,
      // ...) don't include the user's identity, so a stale, still-non-stale-by-staleTime
      // cache entry from whoever was logged in before would otherwise render first for the
      // new account until an unrelated refetch happened to correct it.
      queryClient.clear();
      setSession(session);
    },
  });
}
