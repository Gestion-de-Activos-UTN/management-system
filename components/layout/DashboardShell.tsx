'use client';

import { AppShell, Container, Drawer, Stack } from '@mantine/core';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarItem } from './Sidebar';
import { Breadcrumbs, buildBreadcrumbs } from './Breadcrumbs';
import { TopBar } from './TopBar';

function shouldHideBreadcrumbs(pathname: string): boolean {
  return (
    /^\/portal\/inventory\/[^/]+$/.test(pathname) &&
    !/^\/portal\/inventory\/(snapshots|scan-reports)\/[^/]+$/.test(pathname)
  );
}

export function DashboardShell({
  navItems,
  topBarRight,
  sidebarFooter,
  homeHref,
  children,
}: {
  navItems: SidebarItem[];
  topBarRight?: ReactNode;
  sidebarFooter?: ReactNode;
  homeHref?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const breadcrumbs = buildBreadcrumbs(navItems, homeHref, pathname);
  const showBreadcrumbs = !shouldHideBreadcrumbs(pathname);
  const [mobileNavOpened, setMobileNavOpened] = useState(false);

  useEffect(() => {
    setMobileNavOpened(false);
  }, [pathname]);

  return (
    <AppShell
      header={{ height: 72 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: true, desktop: false },
      }}
      padding={{ base: 'sm', sm: 'md' }}
    >
      <AppShell.Header>
        <TopBar
          opened={mobileNavOpened}
          onToggle={() => setMobileNavOpened((current) => !current)}
          rightSection={topBarRight}
          homeHref={homeHref}
        />
      </AppShell.Header>
      <AppShell.Navbar>
        <Stack justify="space-between" h="100%" gap={0}>
          <Sidebar items={navItems} />
          {sidebarFooter}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Container fluid px={{ base: 0, sm: 'sm', lg: 'md' }}>
          {showBreadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {children}
        </Container>
      </AppShell.Main>
      <Drawer
        opened={mobileNavOpened}
        onClose={() => setMobileNavOpened(false)}
        hiddenFrom="sm"
        position="left"
        size="100%"
        padding="md"
        withCloseButton={false}
        title="Navigation"
      >
        <Stack justify="space-between" h="100%" gap={0}>
          <Sidebar items={navItems} onNavigate={() => setMobileNavOpened(false)} />
          {sidebarFooter}
        </Stack>
      </Drawer>
    </AppShell>
  );
}
