export type Session = { collection: 'admins' | 'users' } | null;

const listeners = new Set<() => void>();
let cached: Session = null;
let hydrated = false;

// No longer backed by localStorage: the JWT lives in the httpOnly `payload-token` cookie
// (see lib/http-client.ts), which JS can't read. `cached` is hydrated once per page load
// by lib/providers.tsx's SessionBootstrap (GET /api/v1/session) and kept in sync from there —
// getSession() itself never fetches, it's a plain synchronous getter for http-client.ts to
// read outside of React.
export function getSession(): Session {
  return cached;
}

export function setSession(session: NonNullable<Session>) {
  cached = session;
  hydrated = true;
  listeners.forEach((listener) => listener());
}

export function clearSession() {
  cached = null;
  hydrated = true;
  listeners.forEach((listener) => listener());
}

export function isSessionHydrated() {
  return hydrated;
}

export function subscribeSession(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
