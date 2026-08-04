'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLink, Stack } from '@mantine/core';
import type { ReactNode } from 'react';

export type SidebarItem = {
  label: string;
  href: string;
  // Pre-rendered element, not a component reference — a bare component
  // (e.g. `icon: Building2`) is not a plain serializable value across
  // the Server -> Client Component boundary (this file is 'use client').
  icon: ReactNode;
};

/**
 * Generic navigation shell — receives its items by prop, no domain
 * knowledge of which modules exist (components/ui-layout stays
 * dependency-free of modules/*, SYSTEM_PROMPT.md #3).
 */
export function Sidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();

  return (
    <Stack gap={4} p="sm">
      {items.map(({ label, href, icon }) => (
        <NavLink
          key={href}
          component={Link}
          href={href}
          label={label}
          leftSection={icon}
          active={pathname === href || pathname.startsWith(`${href}/`)}
          variant="filled"
        />
      ))}
    </Stack>
  );
}
