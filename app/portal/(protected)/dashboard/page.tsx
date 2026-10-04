'use client'

import { useSearchParams } from 'next/navigation'
import { Alert, SimpleGrid, Stack } from '@mantine/core'
import {
  Boxes,
  ClipboardList,
  MapPin,
  RadioTower,
  ScanLine,
  ShieldAlert,
  WifiOff,
  HelpCircle,
  CalendarClock,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { formatDate, formatRelativeDays } from '@/lib/format-date'
import { useConcreteOfficeId } from '@/modules/offices/hooks/use-concrete-office-id'
import { useDashboardMetrics } from '@/modules/dashboard/hooks/use-dashboard-metrics'
import { useRiskSummary } from '@/modules/assessments/hooks/use-risk-summary'
import { useTasks } from '@/modules/tasks/hooks/use-tasks'
import { AttentionCard, type AttentionItem } from '@/modules/dashboard/components/AttentionCard'
import { RiskOverviewCard } from '@/modules/dashboard/components/RiskOverviewCard'
import { MyTasksCard } from '@/modules/dashboard/components/MyTasksCard'
import { MetricsStrip } from '@/modules/dashboard/components/MetricsStrip'

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export default function PortalDashboardPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  // El riesgo existe por organización o por oficina concreta (ver useConcreteOfficeId).
  const { officeId, ready } = useConcreteOfficeId(asOrganization)
  const metrics = useDashboardMetrics(asOrganization)
  const risk = useRiskSummary({ officeId, asOrganization, enabled: ready })
  const tasks = useTasks({ view: 'mine', officeId, asOrganization })
  // Sin la funcionalidad de tareas contratada el endpoint responde 403: la tarjeta no se muestra.
  const tasksAvailable = !tasks.isError

  const query = asOrganization ? `asOrganization=${asOrganization}` : ''
  const href = (path: string, extra?: string) => {
    const params = [extra, query].filter(Boolean).join('&')
    return params ? `${path}?${params}` : path
  }

  const data = metrics.data
  const overdueTasks = (tasks.data ?? []).filter(task => task.is_overdue).length
  const offlineScanners = data ? data.total_scanners - data.online_scanners : 0

  const attention: AttentionItem[] = [
    {
      key: 'overdue-tasks',
      label: plural(overdueTasks, 'tarea vencida', 'tareas vencidas'),
      description: 'Asignadas a ti o reclamadas por ti',
      count: overdueTasks,
      href: href('/portal/tasks'),
      icon: ClipboardList,
      color: 'red',
    },
    {
      key: 'unconfirmed',
      label: plural(
        risk.data?.unconfirmed_assets ?? 0,
        'equipo sin identificar',
        'equipos sin identificar'
      ),
      description: 'No cuentan en el riesgo hasta que se identifican',
      count: risk.data?.unconfirmed_assets ?? 0,
      href: href('/portal/inventory'),
      icon: HelpCircle,
      color: 'yellow',
    },
    {
      key: 'controls',
      label: plural(
        risk.data?.requires_attention ?? 0,
        'control requiere atención',
        'controles requieren atención'
      ),
      description: 'Protecciones ausentes o incompletas',
      count: risk.data?.requires_attention ?? 0,
      href: href('/portal/risk-score'),
      icon: ShieldAlert,
      color: 'orange',
    },
    {
      key: 'manual-reviews',
      label: plural(
        data?.overdue_manual_reviews ?? 0,
        'revisión de activo manual vencida',
        'revisiones de activos manuales vencidas'
      ),
      description: 'Confirma que siguen vigentes',
      count: data?.overdue_manual_reviews ?? 0,
      href: href('/portal/inventory', 'tab=non-network'),
      icon: CalendarClock,
      color: 'red',
    },
    {
      key: 'offline-scanners',
      label: plural(offlineScanners, 'escáner sin conexión', 'escáneres sin conexión'),
      description: 'Sin señal reciente: el inventario puede estar desactualizado',
      count: offlineScanners,
      href: href('/portal/administration/offices'),
      icon: WifiOff,
      color: 'gray',
    },
  ]

  return (
    <Stack gap="lg">
      <PageHeader
        title="Panel general"
        description="Cómo está tu organización y qué necesita atención."
      />
      {metrics.isError && <Alert color="red">No se pudieron cargar las métricas.</Alert>}
      {/* Contexto de infraestructura en una franja compacta; después, por prioridad, el riesgo
          (dato base) y qué hacer para bajarlo. */}
      <MetricsStrip
        isPending={metrics.isPending}
        metrics={[
          { key: 'assets', icon: Boxes, value: data?.total_assets ?? '—', label: 'activos de red' },
          {
            key: 'offices',
            icon: MapPin,
            value: data?.active_offices ?? '—',
            label: 'oficinas activas',
          },
          {
            key: 'scanners',
            icon: RadioTower,
            value: data ? `${data.online_scanners} de ${data.total_scanners}` : '—',
            label: 'escáneres en línea',
          },
          {
            key: 'last-scan',
            icon: ScanLine,
            value: data?.last_scan_at ? formatRelativeDays(data.last_scan_at) : 'Nunca',
            label: data?.last_scan_at
              ? `último escaneo (${formatDate(data.last_scan_at)})`
              : 'último escaneo',
          },
        ]}
      />
      <RiskOverviewCard
        summary={risk.data}
        isPending={risk.isPending}
        href={href('/portal/risk-score')}
      />
      <SimpleGrid cols={{ base: 1, md: tasksAvailable ? 2 : 1 }} spacing="md">
        <AttentionCard
          items={attention}
          isPending={metrics.isPending || risk.isPending || tasks.isPending}
        />
        {tasksAvailable && (
          <MyTasksCard
            tasks={tasks.data ?? []}
            isPending={tasks.isPending}
            tasksHref={href('/portal/tasks')}
            taskHref={id => href(`/portal/tasks/${id}`)}
          />
        )}
      </SimpleGrid>
    </Stack>
  )
}
