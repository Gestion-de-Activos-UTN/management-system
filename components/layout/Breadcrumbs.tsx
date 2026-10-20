'use client'

import Link from 'next/link'
import { Breadcrumbs as MantineBreadcrumbs, Anchor } from '@mantine/core'
import type { SidebarItem } from './Sidebar'

export type Crumb = { label: string; href: string }

function stripQuery(href: string): string {
  return href.split('?')[0]
}

// Finds which top-level item (and, if any, which of its children) matches the current path —
// mirrors Sidebar's own isActivePath matching so the trail and the highlighted nav item never
// disagree about "where you are".
function matchTrail(items: SidebarItem[], pathname: string): SidebarItem[] {
  for (const item of items) {
    if (item.children) {
      const child = item.children.find(c => {
        const p = stripQuery(c.href)
        return pathname === p || pathname.startsWith(`${p}/`)
      })
      if (child) return [item, child]
    }
    const p = stripQuery(item.href)
    if (pathname === p || pathname.startsWith(`${p}/`)) return [item]
  }
  return []
}

// Built from the same navItems/homeHref the Sidebar already renders — the trail is always a
// real, clickable nav destination, never a made-up label for a URL segment that isn't one.
// Only ancestors are shown: the current page is already named by its PageHeader (and
// highlighted in the Sidebar), so repeating it reads as "Tareas / Tareas". A trail that would
// be a lone crumb (a top-level section → just "Panel general") adds nothing and is dropped.
export function buildBreadcrumbs(
  navItems: SidebarItem[],
  homeHref: string | undefined,
  pathname: string
): Crumb[] {
  const trail = matchTrail(navItems, pathname)
  const homePath = homeHref ? stripQuery(homeHref) : undefined
  const crumbs: Crumb[] = []

  if (homeHref && pathname !== homePath) {
    const homeItem = navItems.find(i => stripQuery(i.href) === homePath)
    crumbs.push({ label: homeItem?.label ?? 'Panel general', href: homeHref })
  }

  for (const item of trail) {
    const itemPath = stripQuery(item.href)
    if (itemPath === homePath || itemPath === pathname) continue
    crumbs.push({ label: item.label, href: item.href })
  }

  return crumbs.length > 1 ? crumbs : []
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null

  return (
    <MantineBreadcrumbs separator="/" mb="sm">
      {items.map(crumb => (
        <Anchor
          key={crumb.href}
          component={Link}
          href={crumb.href}
          size="sm"
          c="pine"
          fw={500}
          underline="hover"
          style={{ cursor: 'pointer' }}
        >
          {crumb.label}
        </Anchor>
      ))}
    </MantineBreadcrumbs>
  )
}
