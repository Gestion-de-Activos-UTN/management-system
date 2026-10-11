import { Burger, Group, Text } from '@mantine/core'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ColorSchemeToggle } from '@/components/ui/ColorSchemeToggle'
import { Logo } from '@/components/ui/Logo'

export function TopBar({
  opened,
  onToggle,
  rightSection,
  homeHref = '/',
}: {
  opened: boolean
  onToggle: () => void
  rightSection?: ReactNode
  homeHref?: string
}) {
  return (
    <Group h="100%" px={{ base: 'sm', sm: 'md' }} justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Burger opened={opened} onClick={onToggle} hiddenFrom="sm" size="sm" />
        <Link href={homeHref} style={{ textDecoration: 'none', minWidth: 0 }}>
          <Group gap="0.25rem" align="center" c="pine" wrap="nowrap" style={{ minWidth: 0 }}>
            <Logo height={32} />
            <Text fw={700} fz={{ base: '1.2rem', sm: '1.8rem' }} style={{ lineHeight: 1 }} truncate>
              SIAM
            </Text>
          </Group>
        </Link>
      </Group>
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, justifyContent: 'flex-end' }}>
        {rightSection}
        <ColorSchemeToggle />
      </Group>
    </Group>
  )
}
