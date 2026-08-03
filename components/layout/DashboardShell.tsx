'use client';

import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TopBar } from './TopBar';

export function DashboardShell({
  navItems,
  children,
}: {
  navItems: SidebarItem[];
  children: React.ReactNode;
}) {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 240,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <TopBar opened={opened} onToggle={toggle} />
      </AppShell.Header>
      <AppShell.Navbar>
        <Sidebar items={navItems} />
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
