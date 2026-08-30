'use client'

import { Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core'
import { Boxes, MapPin, RadioTower, ScanLine } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useSearchParams } from 'next/navigation'
import { useDashboardMetrics } from '@/modules/dashboard/hooks/use-dashboard-metrics'
import { formatDateTime } from '@/lib/format-date'

export default function PortalDashboardPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending, isError } = useDashboardMetrics(asOrganization)

  const metrics = [
    { label: 'Total assets', value: data ? String(data.total_assets) : '—', icon: Boxes },
    { label: 'Active offices', value: data ? String(data.active_offices) : '—', icon: MapPin },
    {
      label: 'Online scanners',
      value: data ? String(data.online_scanners) : '—',
      icon: RadioTower,
    },
    {
      label: 'Last scan',
      value: data?.last_scan_at ? formatDateTime(data.last_scan_at) : 'No scans yet',
      icon: ScanLine,
    },
  ]

  return (
    <Stack gap="md">
      <PageHeader title="Dashboard" description="Your organization at a glance." />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {metrics.map(metric => (
          <Card key={metric.label} withBorder padding="lg">
            {isPending ? (
              <Skeleton height={48} />
            ) : isError ? (
              <Text c="red" size="sm">
                Could not load metric
              </Text>
            ) : (
              <Group gap="sm" wrap="wrap" align="flex-start">
                <metric.icon size={20} strokeWidth={1.5} />
                <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
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
  )
}
