'use client'

import { Card, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core'
import { Boxes, MapPin, RadioTower, ScanLine } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useSearchParams } from 'next/navigation'
import { useDashboardMetrics } from '@/modules/dashboard/hooks/use-dashboard-metrics'
import { formatDate, formatTime } from '@/lib/format-date'

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
      // The date is what matters here (how stale is our data) — the time is a
      // secondary detail, so it renders smaller/dimmed instead of fused into
      // one same-weight string with the date.
      value: data?.last_scan_at ? formatDate(data.last_scan_at) : 'No scans yet',
      caption: data?.last_scan_at ? formatTime(data.last_scan_at) : undefined,
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
                    {metric.caption && (
                      <Text span size="sm" fw={400} c="dimmed" ml={6}>
                        {metric.caption}
                      </Text>
                    )}
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
