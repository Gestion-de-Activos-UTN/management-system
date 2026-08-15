'use client';

import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/http-client';
import { useSession } from '@/lib/use-session';

export type TenantContext = {
  userId: string;
  role: 'platform_admin' | 'org_admin' | 'org_viewer' | 'office_manager' | null;
  organizationId: string | null;
  officeIds: string[];
  selectedOfficeId: string | null;
  isPlatformAdmin: boolean;
  isActive: boolean;
};

// Only place this endpoint is queried — mirrors access/tenant/resolveTenantContext.ts's
// TenantContext shape on the backend (endpoints/session.ts just returns it as-is).
// asOrganization must be forwarded and included in the query key — the backend only reads
// ?asOrganization= from THIS request's URL, not from wherever the browser tab currently is,
// and a platform admin switching which org they're visiting needs a real refetch, not a
// stale cache hit from before they clicked "Visit".
export function useTenantContext(asOrganization?: string) {
  const session = useSession();
  return useQuery({
    queryKey: ['tenant-context', asOrganization],
    queryFn: () => httpClient.get<TenantContext>('/api/v1/session', { asOrganization }),
    enabled: !!session?.token,
    staleTime: 60_000,
  });
}

// A platform admin "visiting" an organization (?asOrganization=) should see the same nav/UI
// an org_admin of that org would — role stays 'platform_admin' (true identity, for audit
// honesty), so callers gating on "is this effectively an org admin" check both.
export function isEffectiveOrgAdmin(ctx: TenantContext | null | undefined): boolean {
  return ctx?.role === 'org_admin' || Boolean(ctx?.isPlatformAdmin && ctx?.organizationId);
}

const ROLE_LABELS: Record<string, string> = {
  platform_admin: 'Platform Admin',
  org_admin: 'Org Admin',
  org_viewer: 'Org Viewer',
  office_manager: 'Office Manager',
};

// Display-only — a platform admin visiting an org reads as "Org Admin" here too,
// same as isEffectiveOrgAdmin's nav gating (the backend keeps the real role).
export function roleLabel(ctx: TenantContext | null | undefined): string {
  if (!ctx) return '';
  if (isEffectiveOrgAdmin(ctx)) return 'Org Admin';
  return ROLE_LABELS[ctx.role ?? ''] ?? '';
}
