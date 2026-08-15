'use client';

import { Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { Boxes, ShieldAlert, MapPin, ScanLine } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useFakeLoading } from '@/lib/use-fake-loading';

// ponytail: static placeholder metrics — wire to a real aggregation endpoint once the
// dashboard backend ships.
const FAKE_METRICS = [
  { label: 'Total assets', value: '128', icon: Boxes },
  { label: 'Open risks', value: '7', icon: ShieldAlert },
  { label: 'Active offices', value: '3', icon: MapPin },
  { label: 'Last scan', value: '2h ago', icon: ScanLine },
];

export default function PortalDashboardPage() {
  const loading = useFakeLoading(500);

  return (
    <Stack gap="md">
      <PageHeader title="Dashboard" description="Your organization at a glance." />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {FAKE_METRICS.map((metric) => (
          <Card key={metric.label} withBorder padding="lg">
            {loading ? (
              <Skeleton height={48} />
            ) : (
              <Group gap="sm">
                <metric.icon size={20} strokeWidth={1.5} />
                <Stack gap={0}>
                  <Text size="xl" fw={700}>
                    {metric.value}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {metric.label}
                  </Text>
                </Stack>
              </Group>
            )}
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
