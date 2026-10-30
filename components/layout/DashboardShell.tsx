'use client'

import { APP_HEADER_HEIGHT } from '@/lib/theme'
import { AppShell, Container, Stack, useMantineTheme } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Sidebar, type SidebarItem } from './Sidebar'
import { Breadcrumbs, buildBreadcrumbs } from './Breadcrumbs'
import { TopBar } from './TopBar'

function shouldHideBreadcrumbs(pathname: string): boolean {
  return (
    /^\/portal\/inventory\/[^/]+$/.test(pathname) &&
    // Sólo el detalle de un activo (/portal/inventory/<assetId>) oculta el trail. Las
    // subsecciones de instantáneas e informes de escaneo, lista y detalle, lo conservan.
    !/^\/portal\/inventory\/(snapshots|scan-reports)(\/|$)/.test(pathname)
  )
}

export function DashboardShell({
  navItems,
  topBarRight,
  sidebarFooter,
  homeHref,
  children,
}: {
  navItems: SidebarItem[]
  topBarRight?: ReactNode
  sidebarFooter?: ReactNode
  homeHref?: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const breadcrumbs = buildBreadcrumbs(navItems, homeHref, pathname)
  const showBreadcrumbs = !shouldHideBreadcrumbs(pathname)
  const [mobileNavOpened, setMobileNavOpened] = useState(false)
  const theme = useMantineTheme()
  const desktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`)

  useEffect(() => {
    if (!mobileNavOpened || desktop) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileNavOpened, desktop])

  useEffect(() => {
    setMobileNavOpened(false)
  }, [pathname])

  useEffect(() => {
    if (desktop) setMobileNavOpened(false)
  }, [desktop])

  useEffect(() => {
    if (!mobileNavOpened) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpened(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpened])

  return (
    <AppShell
      header={{ height: APP_HEADER_HEIGHT }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileNavOpened, desktop: false },
      }}
      padding={{ base: 'sm', sm: 'md' }}
    >
      <AppShell.Header>
        <TopBar
          opened={mobileNavOpened}
          onToggle={() => setMobileNavOpened(current => !current)}
          rightSection={topBarRight}
          homeHref={homeHref}
        />
      </AppShell.Header>
      <AppShell.Navbar
        id="main-navigation"
        aria-label="Navegación principal"
        inert={!desktop && !mobileNavOpened ? true : undefined}
        style={{ overflowY: 'auto' }}
      >
        <Stack justify="space-between" h="100%" gap={0}>
          <Sidebar items={navItems} onNavigate={() => setMobileNavOpened(false)} />
          {sidebarFooter}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main inert={mobileNavOpened && !desktop ? true : undefined}>
        <Container fluid px={{ base: 0, sm: 'sm', lg: 'md' }}>
          {showBreadcrumbs && <Breadcrumbs items={breadcrumbs} />}
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}
