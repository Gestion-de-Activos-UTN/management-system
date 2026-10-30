'use client'

import { useSearchParams } from 'next/navigation'
import { Alert, Stack } from '@mantine/core'
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
import { useSession } from '@/lib/use-session'
import { portalHref } from '@/lib/portal-href'
import { formatDate, formatRelativeDays } from '@/lib/format-date'
import { OfficeRiskSelectionNotice } from '@/modules/offices/components/OfficeRiskSelectionNotice'
import { useConcreteOfficeId } from '@/modules/offices/hooks/use-concrete-office-id'
import { useDashboardMetrics } from '@/modules/dashboard/hooks/use-dashboard-metrics'
import { useRiskSummary } from '@/modules/assessments/hooks/use-risk-summary'
import { useTasks } from '@/modules/tasks/hooks/use-tasks'
import { AttentionCard, type AttentionItem } from '@/modules/dashboard/components/AttentionCard'
import { RiskOverviewCard } from '@/modules/dashboard/components/RiskOverviewCard'
import { MyTasksList, openTasks } from '@/modules/dashboard/components/MyTasksList'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { EvidenceCoverageStrip } from '@/modules/dashboard/components/EvidenceCoverageStrip'
import { ActivityTabsCard } from '@/modules/dashboard/components/ActivityTabsCard'
import styles from '@/modules/dashboard/components/DashboardLayout.module.css'
import { PortalMessagesList } from '@/modules/portal-messages/components/PortalMessagesList'
import { usePortalMessages } from '@/modules/portal-messages/hooks/use-portal-messages'
import { isInPortalMessageHistory } from '@/modules/portal-messages/portal-message-labels'

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export default function PortalDashboardPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  // El riesgo existe por organización o por oficina concreta (ver useConcreteOfficeId).
  const { officeId, ready, requiresOfficeSelection } = useConcreteOfficeId(asOrganization)
  const metrics = useDashboardMetrics(asOrganization)
  const risk = useRiskSummary({ officeId, asOrganization, enabled: ready })
  const tasks = useTasks({ view: 'mine', officeId, asOrganization })
  // Misma query que la tarjeta de mensajes (TanStack la comparte): sólo para el contador del tab.
  // Sólo miembros: un admin visitante recibiría 403 (ver PortalMessagesList).
  const messages = usePortalMessages(useSession()?.collection === 'users')
  // Sin la funcionalidad de tareas contratada el endpoint responde 403: la tarjeta no se muestra.
  const tasksAvailable = !tasks.isError

  const href = (path: string, extra?: string) => portalHref(path, asOrganization, extra)

  const riskSummary = requiresOfficeSelection ? undefined : risk.data
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
        riskSummary?.unconfirmed_assets ?? 0,
        'equipo sin identificar',
        'equipos sin identificar'
      ),
      description: 'No cuentan en el riesgo hasta que se identifican',
      count: riskSummary?.unconfirmed_assets ?? 0,
      href: href('/portal/inventory'),
      icon: HelpCircle,
      color: 'yellow',
    },
    {
      key: 'controls',
      label: plural(
        riskSummary?.requires_attention ?? 0,
        'control requiere atención',
        'controles requieren atención'
      ),
      description: 'Protecciones ausentes o incompletas',
      count: riskSummary?.requires_attention ?? 0,
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
      <div className={styles.layout}>
        <div className={styles.main}>
          {requiresOfficeSelection ? (
            <OfficeRiskSelectionNotice />
          ) : (
            <RiskOverviewCard
              summary={risk.data}
              isPending={risk.isPending}
              href={href('/portal/risk-score')}
            />
          )}
        </div>
        {/* Lateral: lo que requiere atención. */}
        <div className={styles.side}>
          <AttentionCard
            items={attention}
            isPending={
              metrics.isPending || (!requiresOfficeSelection && risk.isPending) || tasks.isPending
            }
          />
        </div>
        {/* Contexto numérico debajo del riesgo: infraestructura y calidad de la evidencia. */}
        <div className={styles.stats}>
          <MetricsStrip
            isPending={metrics.isPending}
            metrics={[
              {
                key: 'assets',
                icon: Boxes,
                value: data?.total_assets ?? '—',
                label: 'activos de red',
              },
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
          {!requiresOfficeSelection && (
            <EvidenceCoverageStrip summary={risk.data} isPending={risk.isPending} />
          )}
        </div>
        <div className={styles.activity}>
          <ActivityTabsCard
            tasksCount={tasksAvailable && tasks.data ? openTasks(tasks.data).length : undefined}
            messagesCount={messages.data?.filter(item => isInPortalMessageHistory(item)).length}
            tasks={
              tasksAvailable ? (
                <MyTasksList
                  tasks={tasks.data ?? []}
                  isPending={tasks.isPending}
                  tasksHref={href('/portal/tasks')}
                  taskHref={id => href(`/portal/tasks/${id}`)}
                />
              ) : undefined
            }
            messages={<PortalMessagesList />}
          />
        </div>
      </div>
    </Stack>
  )
}
