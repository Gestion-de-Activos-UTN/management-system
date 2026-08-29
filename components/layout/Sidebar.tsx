'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ActionIcon, Collapse, NavLink, Stack, ThemeIcon } from '@mantine/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

export type SidebarItem = {
  label: string
  href: string
  // Pre-rendered element, not a component reference — a bare component
  // (e.g. `icon: Building2`) is not a plain serializable value across
  // the Server -> Client Component boundary (this file is 'use client').
  icon: ReactNode
  // Optional nested sub-sections (e.g. Inventory -> Snapshot History).
  children?: SidebarItem[]
}

function isActivePath(pathname: string, href: string): boolean {
  // href may carry ?asOrganization= — compare on the path only, a
  // querystring shouldn't break the active-item match.
  const hrefPath = href.split('?')[0]
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)
}

// Mantine's NavLink, when given a `children` prop, hijacks the row's own click to toggle
// open/closed instead of following component={Link}/href — there is no way to have both
// "click the row navigates" and "click the row expands" on the SAME element. So the expand
// toggle lives on its own ActionIcon (stopPropagation + preventDefault so it never bubbles
// into the parent Link's navigation), and the children render in a plain, manually-controlled
// <Collapse> instead of NavLink's own children prop.
function SidebarNavItem({
  item,
  pathname,
  onNavigate,
}: {
  item: SidebarItem
  pathname: string
  onNavigate?: () => void
}) {
  const childActive = item.children?.some(child => isActivePath(pathname, child.href)) ?? false
  // A child's own href is a more specific prefix of the parent's — without excluding
  // childActive here, both light up filled at once on a child route (e.g. Inventory AND
  // Snapshot History both green while on /inventory/snapshots), which reads as "which one is
  // it?" instead of showing exactly where you are.
  const active = isActivePath(pathname, item.href) && !childActive
  const [opened, setOpened] = useState(active || childActive)
  const hasChildren = Boolean(item.children?.length)

  return (
    <>
      <NavLink
        component={Link}
        href={item.href}
        label={item.label}
        leftSection={
          <ThemeIcon variant={active ? 'filled' : 'light'} color="pine" size={30} radius="md">
            {item.icon}
          </ThemeIcon>
        }
        rightSection={
          hasChildren ? (
            <ActionIcon
              component="span"
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={opened ? 'Collapse section' : 'Expand section'}
              onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                setOpened(o => !o)
              }}
            >
              {opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </ActionIcon>
          ) : undefined
        }
        active={active}
        variant="filled"
        py={12}
        onClick={onNavigate}
        style={childActive ? { borderLeft: '3px solid var(--mantine-color-pine-6)' } : undefined}
        styles={{ label: { fontWeight: active ? 600 : 500 } }}
      />
      {hasChildren && (
        <Collapse in={opened}>
          <Stack gap={4} pl={28} pt={4}>
            {item.children!.map(child => {
              const childIsActive = isActivePath(pathname, child.href)
              return (
                <NavLink
                  key={child.href}
                  component={Link}
                  href={child.href}
                  label={child.label}
                  leftSection={
                    <ThemeIcon
                      variant={childIsActive ? 'filled' : 'light'}
                      color="pine"
                      size={24}
                      radius="md"
                    >
                      {child.icon}
                    </ThemeIcon>
                  }
                  active={childIsActive}
                  variant="filled"
                  py={10}
                  onClick={onNavigate}
                  styles={{ label: { fontWeight: childIsActive ? 600 : 500 } }}
                />
              )
            })}
          </Stack>
        </Collapse>
      )}
    </>
  )
}

/**
 * Generic navigation shell — receives its items by prop, no domain
 * knowledge of which modules exist (components/ui-layout stays
 * dependency-free of modules/*, SYSTEM_PROMPT.md #3).
 */
export function Sidebar({
  items,
  onNavigate,
}: {
  items: SidebarItem[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <Stack gap={6} p="md">
      {items.map(item => (
        <SidebarNavItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </Stack>
  )
}
