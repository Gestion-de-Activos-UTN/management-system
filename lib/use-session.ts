'use client';

import { useSyncExternalStore } from 'react';
import { getSession, isSessionHydrated, subscribeSession, type Session } from './session';

// `undefined` = SessionBootstrap's GET /api/v1/session (lib/providers.tsx) hasn't resolved
// yet — the session now lives in an httpOnly cookie, not localStorage, so there's no
// synchronous client-side read; it always starts as a network round-trip. Callers must only
// redirect on `null` (confirmed no session), never on `undefined` (still figuring it out).
export function useSession(): Session | undefined {
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  return isSessionHydrated() ? session : undefined;
}
