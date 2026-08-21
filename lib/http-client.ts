import { clearSession, getSession } from './session';

export type HttpError = { status: number; code: string; message: string };

function withParams(path: string, params?: Record<string, string | undefined>) {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, value);
  }
  const search = qs.toString();
  return search ? `${path}?${search}` : path;
}

// Single in-flight refresh shared by every request that hits a 401 at the same time —
// without this, N concurrent requests failing together would each fire their own
// /refresh-token, which is both wasteful and races on which one's cookie wins.
let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    const session = getSession();
    refreshPromise = (async () => {
      if (!session) return false;
      const res = await fetch(`/api/${session.collection}/refresh-token`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function rawRequest(method: string, path: string, body?: unknown) {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    // The session lives in the httpOnly `payload-token` cookie now (see collections/Users
    // and collections/Admins auth.cookies) — no more manual Authorization header.
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(
  method: string,
  path: string,
  opts?: { params?: Record<string, string | undefined>; body?: unknown; isRetry?: boolean },
): Promise<T> {
  const fullPath = withParams(path, opts?.params);
  const res = await rawRequest(method, fullPath, opts?.body);

  if (res.status === 401 && !opts?.isRetry && getSession()) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(method, path, { ...opts, isRetry: true });
    }
    // Refresh failed too — the cookie is gone/expired for good, stop here instead of
    // looping: clear local state so the protected layouts redirect to /login on their own.
    clearSession();
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error: HttpError = {
      status: res.status,
      code: data?.errors?.[0]?.name ?? 'request_failed',
      message: data?.errors?.[0]?.message ?? data?.message ?? data?.error ?? res.statusText,
    };
    throw error;
  }

  return data as T;
}

export const httpClient = {
  get: <T>(path: string, params?: Record<string, string | undefined>) =>
    request<T>('GET', path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
};
