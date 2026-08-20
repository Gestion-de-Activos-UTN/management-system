'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Center, Group, Loader, Stack, Text } from '@mantine/core';
import { ArrowLeft, LayoutDashboard, Gauge, Boxes, ShieldCheck } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { SidebarProfile } from '@/components/layout/SidebarProfile';
import type { SidebarItem } from '@/components/layout/Sidebar';
import { useSession } from '@/lib/use-session';
import { useTenantContext, isEffectiveOrgAdmin, roleLabel } from '@/modules/auth/hooks/use-tenant-context';
import { OfficeSelector } from '@/modules/offices/components/OfficeSelector';

// ponytail/debt: same client-side-only gate as the admin portal's (protected)/layout.tsx —
// Loader while useSession()/useTenantContext() resolve, then redirect. The JWT lives in
// localStorage (never a cookie), so Next middleware/SSR can't see it and there is no
// server-side gate possible today. Temporary: revisit when the Auth0 migration
// (access/tenant/identityProvider.ts's documented auth0IdentityProvider swap) restores a
// real session Next can read at request time.
// useSearchParams() needs a Suspense ancestor within this page's own render tree for
// static prerendering (Next.js CSR bailout) — split out so the default export below can
// provide one. Nested layouts/pages that also call useSearchParams (admin layout,
// individual pages) render as `children` inside this same subtree, so they're covered too.
function PortalProtectedLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const searchParams = useSearchParams();
  const asOrganization = searchParams.get('asOrganization') ?? undefined;
  // A platform admin only belongs here while actively "visiting" an org (?asOrganization=) —
  // the "Visit" button on the Organizations table is the only entry point, see
  // modules/organizations/organizations.columns.tsx.
  const isAdminVisiting = session?.collection === 'admins' && !!asOrganization;
  const allowed = !!session && (session.collection === 'users' || isAdminVisiting);
  const tenantContext = useTenantContext(asOrganization);

  useEffect(() => {
    if (session === undefined) return; // still resolving — see lib/use-session.ts
    if (!session) {
      router.replace('/login');
    } else if (session.collection === 'admins' && !asOrganization) {
      router.replace('/');
    }
  }, [session, asOrganization, router]);

  if (session === undefined || !allowed || tenantContext.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  // A failed fetch here must not silently fall through with tenantContext.data left
  // undefined — RBAC-gated nav (e.g. "Administration" below) reads isOrgAdmin as false
  // in that case, hiding it with no visible error, until some unrelated page happens to
  // mount its own useTenantContext() and TanStack Query's refetchOnMount papers over it.
  if (tenantContext.isError) {
    return (
      <Center h="100vh">
        <Stack align="center" gap="sm">
          <Text c="dimmed">Couldn't load your organization context.</Text>
          <Button variant="light" onClick={() => tenantContext.refetch()}>
            Retry
          </Button>
        </Stack>
      </Center>
    );
  }

  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : '';
  const isOrgAdmin = isEffectiveOrgAdmin(tenantContext.data);
  const navItems: SidebarItem[] = [
    {
      label: 'Dashboard',
      href: `/portal/dashboard${suffix}`,
      icon: <LayoutDashboard size={18} strokeWidth={1.5} />,
    },
    {
      label: 'Risk Score',
      href: `/portal/risk-score${suffix}`,
      icon: <Gauge size={18} strokeWidth={1.5} />,
    },
    {
      label: 'Inventory',
      href: `/portal/inventory${suffix}`,
      icon: <Boxes size={18} strokeWidth={1.5} />,
    },
    ...(isOrgAdmin
      ? [
          {
            label: 'Administration',
            href: `/portal/admin${suffix}`,
            icon: <ShieldCheck size={18} strokeWidth={1.5} />,
          },
        ]
      : []),
  ];

  return (
    <DashboardShell
      navItems={navItems}
      sidebarFooter={<SidebarProfile title={roleLabel(tenantContext.data)} />}
      homeHref={`/portal/dashboard${suffix}`}
      topBarRight={
        <Group gap="sm">
          {isAdminVisiting && (
            <Button
              component={Link}
              href="/"
              variant="light"
              size="sm"
              leftSection={<ArrowLeft size={16} strokeWidth={1.5} />}
            >
              Back to Platform Portal
            </Button>
          )}
          <OfficeSelector />
        </Group>
      }
    >
      {children}
    </DashboardShell>
  );
}

export default function PortalProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Center h="100vh">
          <Loader />
        </Center>
      }
    >
      <PortalProtectedLayoutInner>{children}</PortalProtectedLayoutInner>
    </Suspense>
  );
}
