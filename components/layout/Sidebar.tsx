'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLink, Stack, ThemeIcon } from '@mantine/core';
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
    <Stack gap={6} p="md">
      {items.map(({ label, href, icon }) => {
        // href may carry ?asOrganization= — compare on the path only, a
        // querystring shouldn't break the active-item match.
        const hrefPath = href.split('?')[0];
        const active = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);

        return (
          <NavLink
            key={href}
            component={Link}
            href={href}
            label={label}
            leftSection={
              <ThemeIcon variant={active ? 'filled' : 'light'} color="pine" size={30} radius="md">
                {icon}
              </ThemeIcon>
            }
            active={active}
            variant="filled"
            py={10}
            styles={{ label: { fontWeight: active ? 600 : 500 } }}
          />
        );
      })}
    </Stack>
  );
}
