'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Card, SimpleGrid, Stack, Text } from '@mantine/core'
import { Users, MapPin, Settings } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'

const HUB_ITEMS = [
  {
    label: 'Usuarios',
    href: '/portal/administration/users',
    icon: Users,
    description: 'Miembros de tu organización',
  },
  {
    label: 'Oficinas',
    href: '/portal/administration/offices',
    icon: MapPin,
    description: 'Oficinas de tu organización',
  },
  {
    label: 'Configuración',
    href: '/portal/administration/settings',
    icon: Settings,
    description: 'Configuración de la organización',
  },
]

export default function PortalAdminHub() {
  const asOrganization = useSearchParams().get('asOrganization')
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''

  return (
    <Stack gap="md">
      <PageHeader
        title="Administración"
        description="Administra los usuarios, las oficinas y la configuración de tu organización."
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {HUB_ITEMS.map(item => (
          <Card
            key={item.href}
            component={Link}
            href={`${item.href}${suffix}`}
            withBorder
            padding="lg"
            h="100%"
          >
            <Stack gap={6} h="100%">
              <item.icon size={20} strokeWidth={1.5} />
              <Text fw={600}>{item.label}</Text>
              <Text size="sm" c="dimmed">
                {item.description}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  )
}
