'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, type Session } from './session';

// `undefined` = not yet resolved on the client. The server has no localStorage, so
// useSyncExternalStore's server/hydration snapshot can only ever be `null` — a route
// guard that treats `!session` as "logged out" fires that redirect on this transient
// value on every full page load (hard refresh, typed URL), before the real client
// snapshot ever renders. Callers must only redirect on `null` (confirmed no session),
// never on `undefined` (still figuring it out).
export function useSession(): Session | undefined {
  const [hydrated, setHydrated] = useState(false);
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated ? session : undefined;
}
