'use client'

import { Alert, Button, Stack } from '@mantine/core'
import { Building2, MapPin, Radio, RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
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

      <MetricsStrip
        isPending={metrics.isPending}
        metrics={[
          {
            key: 'organizations',
            icon: Building2,
            value: totalOrganizations,
            label: 'organizaciones',
            description: `${activeOrganizations} activas · ${Math.max(0, totalOrganizations - activeOrganizations)} inactivas`,
          },
          {
            key: 'offices',
            icon: MapPin,
            value: metrics.data?.active_offices ?? 0,
            label: 'oficinas activas',
            description: 'En todas las organizaciones',
          },
          {
            key: 'agents',
            icon: Radio,
            value: onlineAgents,
            label: 'agentes conectados',
            description: `De ${activeAgents} agentes activos`,
          },
          {
            key: 'incidents',
            icon: TriangleAlert,
            value: metrics.data?.pending_incidents ?? 0,
            label: 'incidentes pendientes',
            description: 'En todas las organizaciones',
          },
        ]}
      />
    </Stack>
  )
}
