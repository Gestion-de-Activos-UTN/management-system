'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, SimpleGrid, Stack, Text } from '@mantine/core';
import { Users, MapPin, Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

const HUB_ITEMS = [
  { label: 'Users', href: '/portal/administration/users', icon: Users, description: 'Members of your organization' },
  { label: 'Offices', href: '/portal/administration/offices', icon: MapPin, description: 'Offices in your organization' },
  { label: 'Settings', href: '/portal/administration/settings', icon: Settings, description: 'Organization-level settings' },
];

export default function PortalAdminHub() {
  const asOrganization = useSearchParams().get('asOrganization');
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : '';

  return (
    <Stack gap="md">
      <PageHeader title="Administration" description="Manage your organization's users, offices and settings." />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {HUB_ITEMS.map((item) => (
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
  );
}
