'use client'

import { Alert, Button, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core'
import { Building2, MapPin, Radio, RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { usePlatformDashboard } from '../hooks/use-platform-dashboard'

export function PlatformDashboard() {
  const metrics = usePlatformDashboard()
  const activeOrganizations = metrics.data?.organizations.active ?? 0
  const totalOrganizations = metrics.data?.organizations.total ?? 0
  const activeAgents = metrics.data?.agents.active ?? 0
  const onlineAgents = metrics.data?.agents.online ?? 0

  return (
    <Stack gap="lg">
      <PageHeader
        title="Panel de plataforma"
        description="Indicadores generales de las organizaciones."
        rightSection={
          <Button
            variant="light"
            leftSection={<RefreshCw size={16} strokeWidth={1.5} />}
            loading={metrics.isFetching}
            onClick={() => void metrics.refetch()}
          >
            Actualizar
          </Button>
        }
      />

      {metrics.isError && (
        <Alert color="red" title="No se pudo cargar el resumen">
          Actualiza la página para volver a intentar.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, xl: 4 }}>
        <MetricCard
          loading={metrics.isPending}
          icon={<Building2 size={18} strokeWidth={1.5} />}
          title="Organizaciones"
          value={totalOrganizations}
          description={`${activeOrganizations} activas · ${Math.max(0, totalOrganizations - activeOrganizations)} inactivas`}
        />
        <MetricCard
          loading={metrics.isPending}
          icon={<MapPin size={18} strokeWidth={1.5} />}
          title="Oficinas activas"
          value={metrics.data?.active_offices ?? 0}
          description="En todas las organizaciones"
        />
        <MetricCard
          loading={metrics.isPending}
          icon={<Radio size={18} strokeWidth={1.5} />}
          title="Agentes conectados"
          value={onlineAgents}
          description={`De ${activeAgents} agentes activos`}
        />
        <MetricCard
          loading={metrics.isPending}
          icon={<TriangleAlert size={18} strokeWidth={1.5} />}
          title="Incidentes pendientes"
          value={metrics.data?.pending_incidents ?? 0}
          description="En todas las organizaciones"
          emphasis={(metrics.data?.pending_incidents ?? 0) > 0}
        />
      </SimpleGrid>
    </Stack>
  )
}

function MetricCard({
  loading,
  icon,
  title,
  value,
  description,
  emphasis = false,
}: {
  loading: boolean
  icon: React.ReactNode
  title: string
  value: React.ReactNode
  description: string
  emphasis?: boolean
}) {
  if (loading) return <Skeleton h={116} radius="md" />
  return (
    <StatCard
      icon={
        <Group c={emphasis ? 'orange' : 'teal'} gap="xs">
          {icon}
          <Text size="sm" fw={600} c="dimmed">
            {title}
          </Text>
        </Group>
      }
      value={value}
      label={description}
    />
  )
}
