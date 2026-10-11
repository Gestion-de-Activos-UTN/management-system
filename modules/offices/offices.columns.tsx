import type { ColumnDef } from '@tanstack/react-table'
import { Stack, Text, Tooltip } from '@mantine/core'
import type { Office } from '@/app/types/payload-types'
import { activeStatusColumn } from '@/components/ui/activeStatusColumn'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { locationLabel } from '@/lib/argentina-geo'
import { getOfficeScannerStatus, type OfficeAgentSummary } from '@/endpoints/officeAgentSummary'
import { RowActions } from './components/RowActions'

const SCANNER_STATUS: Record<
  ReturnType<typeof getOfficeScannerStatus>,
  { tone: StatusTone; label: string }
> = {
  not_installed: { tone: 'neutral', label: 'No instalado' },
  inactive: { tone: 'neutral', label: 'Inactivo' },
  pending: { tone: 'info', label: 'Pendiente' },
  online: { tone: 'success', label: 'En línea' },
  offline: { tone: 'warning', label: 'Sin conexión' },
}

function scannerTooltip(
  summary: OfficeAgentSummary | undefined,
  status: keyof typeof SCANNER_STATUS
) {
  if (status === 'not_installed' || !summary) return 'No se aprovisionó ningún escáner'
  if (status === 'inactive')
    return 'total' in summary
      ? `${summary.total} agente(s) aprovisionado(s), todos inactivos`
      : 'El escáner está inactivo'
  if (status === 'pending') return 'Escáner aprovisionado; esperando su primera señal'
  if (status === 'online')
    return 'agents' in summary
      ? `${summary.online} de ${summary.active} agente(s) activo(s) en línea`
      : 'El escáner está conectado'
  return 'active' in summary
    ? `${summary.active} agente(s) activo(s), ninguno en línea`
    : 'El escáner no está conectado'
}

export function getOfficesColumns(
  actions: {
    onScanner: (office: Office) => void
    onEdit: (office: Office) => void
    onToggleActive: (office: Office) => void
  },
  agentSummary: OfficeAgentSummary[] = []
): ColumnDef<Office, unknown>[] {
  const summaryByOffice = new Map(agentSummary.map(summary => [summary.office_id, summary]))

  return [
    {
      accessorKey: 'name',
      header: 'Oficina',
      cell: ({ row }) => {
        const location = locationLabel(row.original.province_id, row.original.department_id)
        return (
          <Stack gap={0}>
            <Text size="sm" fw={600}>
              {row.original.name}
            </Text>
            <Text size="xs" c="dimmed">
              {location ?? 'Sin ubicación cargada'}
            </Text>
          </Stack>
        )
      },
    },
    activeStatusColumn<Office>(office => office.is_active !== false, {
      true: 'Activa',
      false: 'Inactiva',
    }),
    {
      id: 'scanner',
      header: 'Escáner',
      size: 150,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const summary = summaryByOffice.get(String(row.original.id))
        const status = getOfficeScannerStatus(summary)
        return (
          <Tooltip label={scannerTooltip(summary, status)}>
            <span>
              <StatusBadge {...SCANNER_STATUS[status]} />
            </span>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      size: 140,
      enableSorting: false,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const summary = summaryByOffice.get(String(row.original.id))
        return (
          <RowActions
            office={row.original}
            hasAgents={Boolean(summary && getOfficeScannerStatus(summary) !== 'not_installed')}
            {...actions}
          />
        )
      },
    },
  ]
}
