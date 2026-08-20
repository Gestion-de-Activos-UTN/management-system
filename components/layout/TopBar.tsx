import { Group, Text, Burger } from '@mantine/core'
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
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={opened} onClick={onToggle} hiddenFrom="sm" size="sm" />
        <Link href={homeHref} style={{ textDecoration: 'none' }}>
          <Group gap="0.25rem" align="center" c="pine">
            <Logo height={40} />
            <Text fw={700} size="1.8rem" style={{ lineHeight: 1 }}>
              SIAM
            </Text>
          </Group>
        </Link>
      </Group>
      <Group gap="sm">
        {rightSection}
        <ColorSchemeToggle />
      </Group>
    </Group>
  )
}
