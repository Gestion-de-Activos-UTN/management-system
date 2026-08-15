'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Center, Loader } from '@mantine/core';
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

  if (tenantContext.isPending || !isOrgAdmin) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  return <>{children}</>;
}
