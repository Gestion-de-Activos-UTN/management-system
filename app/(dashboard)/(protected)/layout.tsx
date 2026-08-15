'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ActionIcon, Badge, Center, Group, Loader } from '@mantine/core';
import { Building2, X } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { SidebarProfile } from '@/components/layout/SidebarProfile';
import type { SidebarItem } from '@/components/layout/Sidebar';
import { useSession } from '@/lib/use-session';
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context';

// ponytail/debt: this gate is client-side only — Loader while useSession()/useTenantContext()
// resolve, then redirect. The JWT lives in localStorage (never a cookie, per the
// no-credentials-include constraint), so Next middleware/SSR can't see it and there is no
// server-side gate possible today. Temporary: revisit when the Auth0 migration
// (access/tenant/identityProvider.ts's documented auth0IdentityProvider swap) restores a
// real session Next can read at request time.
// useSearchParams() needs a Suspense ancestor within this page's own render tree for
// static prerendering (Next.js CSR bailout) — split out so the default export below can
// provide one. Nested layouts/pages that also call useSearchParams (portal admin layout,
// individual pages) render as `children` inside this same subtree, so they're covered too.
function AdminProtectedLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const searchParams = useSearchParams();
  const asOrganization = searchParams.get('asOrganization');
  const tenantContext = useTenantContext(asOrganization ?? undefined);

  useEffect(() => {
    if (session === undefined) return; // still resolving — see lib/use-session.ts
    if (!session || session.collection !== 'admins') {
      router.replace('/login');
    }
  }, [session, router]);

  if (session === undefined || !session || session.collection !== 'admins' || tenantContext.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  // Preserve ?asOrganization= across nav clicks — the generic Sidebar stays
  // portal-agnostic, this is where the query param gets folded into each href.
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : '';
  const navItems: SidebarItem[] = [
    { label: 'Organizations', href: `/organizations${suffix}`, icon: <Building2 size={18} strokeWidth={1.5} /> },
  ];

  return (
    <DashboardShell
      navItems={navItems}
      sidebarFooter={<SidebarProfile title="Platform Admin" />}
      topBarRight={
        asOrganization ? (
          <Group gap={4}>
            <Badge variant="light" ff="monospace" tt="none">
              Viewing: {asOrganization}
            </Badge>
            <ActionIcon
              component="a"
              href={pathname}
              variant="subtle"
              size="md"
              aria-label="Exit organization view"
            >
              <X size={20} strokeWidth={1.5} />
            </ActionIcon>
          </Group>
        ) : undefined
      }
    >
      {children}
    </DashboardShell>
  );
}

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Center h="100vh">
          <Loader />
        </Center>
      }
    >
      <AdminProtectedLayoutInner>{children}</AdminProtectedLayoutInner>
    </Suspense>
  );
}
