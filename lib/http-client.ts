import { getSession } from './session';

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

async function request<T>(
  method: string,
  path: string,
  opts?: { params?: Record<string, string | undefined>; body?: unknown },
): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

  // Never credentials: 'include' — Payload keeps one global session cookie shared across
  // the `users`/`admins` auth collections, so the frontend authenticates purely via the
  // Bearer token above, never the cookie (see access/tenant/identityProvider.ts).
  const res = await fetch(withParams(path, opts?.params), {
    method,
    headers,
    credentials: 'omit',
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

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
