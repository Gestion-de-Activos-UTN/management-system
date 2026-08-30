'use client';

import { notFound, useSearchParams } from 'next/navigation';
import { Button, Center, Loader, Stack, Text } from '@mantine/core';
import { useTenantContext, isEffectiveOrgAdmin } from '@/modules/auth/hooks/use-tenant-context';

// ponytail/debt: role gate is client-side only, same limitation as portal/(protected)/layout.tsx
// (no server-side session to check before the Auth0 migration) — see that file's comment for
// the full note.
export default function PortalAdminLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const asOrganization = searchParams.get('asOrganization') ?? undefined;
  const tenantContext = useTenantContext(asOrganization);
  const isOrgAdmin = isEffectiveOrgAdmin(tenantContext.data);

  // Same failure mode as portal/(protected)/layout.tsx: without this, a failed fetch leaves
  // tenantContext.data undefined -> isOrgAdmin false -> the check below 404s the user out of
  // /portal/administration even though they may well be an org_admin, just with a
  // stale/errored tenant-context fetch.
  if (tenantContext.isError) {
    return (
      <Center h="60vh">
        <Stack align="center" gap="sm">
          <Text c="dimmed">Couldn't load your organization context.</Text>
          <Button variant="light" onClick={() => tenantContext.refetch()}>
            Retry
          </Button>
        </Stack>
      </Center>
    );
  }

  if (tenantContext.isPending) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  // Renders the global not-found boundary instead of bouncing to /portal/dashboard: a redirect
  // there would confirm to anyone poking at the URL that /portal/administration exists but is
  // gated, leaking which routes are permission-walled. A 404 looks identical to a route that
  // was never there at all.
  if (!isOrgAdmin) {
    notFound();
  }

  return <>{children}</>;
}
