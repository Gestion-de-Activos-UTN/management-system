import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Cheap server-side gate: today the protected layouts (app/(dashboard)/(protected)/layout.tsx,
// app/portal/(protected)/layout.tsx) render their full HTML/RSC payload before a client-side
// `useEffect` redirects an unauthenticated visitor to /login — this closes that gap without
// duplicating Payload's real auth/tenant checks. It only checks whether the session cookie
// exists at all; it doesn't decode or verify the JWT (no Node-only crypto/DB calls from
// middleware) — fine-grained checks (collection, tenant, is_active) still happen server-side
// on every real request via /v1/session (access/tenant/resolveTenantContext.ts).
// Cookie name comes from payload.config.ts's (default) `cookiePrefix: 'payload'` — shared by
// both Users and Admins, see collections/Users/index.ts.
const SESSION_COOKIE = 'payload-token';

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/account', '/organizations/:path*', '/portal/:path*'],
};
