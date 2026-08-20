'use client';

import { AppShell, Container, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { useUiStore } from '@/lib/ui-store';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TopBar } from './TopBar';

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
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const opened = !sidebarCollapsed;

  return (
    <AppShell
      header={{ height: 72 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <TopBar opened={opened} onToggle={toggleSidebar} rightSection={topBarRight} homeHref={homeHref} />
      </AppShell.Header>
      <AppShell.Navbar>
        <Stack justify="space-between" h="100%" gap={0}>
          <Sidebar items={navItems} />
          {sidebarFooter}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        {/* Caps content width so it doesn't stretch edge-to-edge on wide
            screens — without this, an unconstrained table lets the browser's
            table-layout:auto algorithm stretch trailing columns into empty
            space instead of sizing to content. */}
        <Container size={1100} px={0}>
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
