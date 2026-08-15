'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Center, Loader, Stack, Text } from '@mantine/core';
import { useTenantContext, isEffectiveOrgAdmin } from '@/modules/auth/hooks/use-tenant-context';

// ponytail/debt: role gate is client-side only, same limitation as portal/(protected)/layout.tsx
// (no server-side session to check before the Auth0 migration) — see that file's comment for
// the full note.
export default function PortalAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const asOrganization = searchParams.get('asOrganization') ?? undefined;
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : '';
  const tenantContext = useTenantContext(asOrganization);
  const isOrgAdmin = isEffectiveOrgAdmin(tenantContext.data);

  useEffect(() => {
    if (tenantContext.data && !isOrgAdmin) {
      router.replace(`/portal/dashboard${suffix}`);
    }
  }, [tenantContext.data, isOrgAdmin, router, suffix]);

  // Same failure mode as portal/(protected)/layout.tsx: without this, a failed fetch leaves
  // tenantContext.data undefined -> isOrgAdmin false -> the effect above bounces the user
  // out of /portal/admin even though they may well be an org_admin, just with a stale/errored
  // tenant-context fetch.
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

  if (tenantContext.isPending || !isOrgAdmin) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  return <>{children}</>;
}
