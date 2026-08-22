'use client';

import Link from 'next/link';
import { Breadcrumbs as MantineBreadcrumbs, Anchor, Text } from '@mantine/core';
import type { SidebarItem } from './Sidebar';

export type Crumb = { label: string; href: string; current: boolean };

function stripQuery(href: string): string {
  return href.split('?')[0];
}

// Finds which top-level item (and, if any, which of its children) matches the current path —
// mirrors Sidebar's own isActivePath matching so the trail and the highlighted nav item never
// disagree about "where you are".
function matchTrail(items: SidebarItem[], pathname: string): SidebarItem[] {
  for (const item of items) {
    if (item.children) {
      const child = item.children.find((c) => {
        const p = stripQuery(c.href);
        return pathname === p || pathname.startsWith(`${p}/`);
      });
      if (child) return [item, child];
    }
    const p = stripQuery(item.href);
    if (pathname === p || pathname.startsWith(`${p}/`)) return [item];
  }
  return [];
}

// Built from the same navItems/homeHref the Sidebar already renders — the trail is always a
// real, clickable nav destination, never a made-up label for a URL segment that isn't one.
export function buildBreadcrumbs(navItems: SidebarItem[], homeHref: string | undefined, pathname: string): Crumb[] {
  const trail = matchTrail(navItems, pathname);
  const homePath = homeHref ? stripQuery(homeHref) : undefined;
  const crumbs: Crumb[] = [];

  if (homeHref) {
    const homeItem = navItems.find((i) => stripQuery(i.href) === homePath);
    crumbs.push({ label: homeItem?.label ?? 'Dashboard', href: homeHref, current: pathname === homePath });
  }

  for (const item of trail) {
    const itemPath = stripQuery(item.href);
    if (itemPath === homePath) continue; // avoid "Dashboard / Dashboard" on the home page itself
    // `current` is an exact path match, NOT "is this the last matched nav item" — a detail page
    // one level deeper than any nav item (e.g. a specific snapshot under Snapshot History) has
    // no exact match at all, so every crumb it does have stays a real, clickable way back.
    crumbs.push({ label: item.label, href: item.href, current: pathname === itemPath });
  }

  return crumbs;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <MantineBreadcrumbs separator="/" mb="sm">
      {items.map((crumb) =>
        crumb.current ? (
          <Text key={crumb.href} size="sm" c="dimmed">
            {crumb.label}
          </Text>
        ) : (
          <Anchor key={crumb.href} component={Link} href={crumb.href} size="sm" c="dimmed">
            {crumb.label}
          </Anchor>
        ),
      )}
    </MantineBreadcrumbs>
  );
}
