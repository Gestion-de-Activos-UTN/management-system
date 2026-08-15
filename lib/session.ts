export type Session = { token: string; collection: 'admins' | 'users' } | null;

const STORAGE_KEY = 'siam.session';
const listeners = new Set<() => void>();
let cached: Session = null;
let hydrated = false;

function readStorage(): Session {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

// Own cross-cutting layer, deliberately neither TanStack Query (not server-fetched
// data with staleness) nor Zustand (reserved for UI state, not auth credentials) —
// see the plan's rationale. Session lives here so lib/http-client.ts can read it
// synchronously outside of React (a plain getter, not a hook).
export function getSession(): Session {
  if (!hydrated) {
    cached = readStorage();
    hydrated = true;
  }
  return cached;
}

export function setSession(session: NonNullable<Session>) {
  cached = session;
  hydrated = true;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  listeners.forEach((listener) => listener());
}

export function clearSession() {
  cached = null;
  hydrated = true;
  window.localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

export function subscribeSession(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
