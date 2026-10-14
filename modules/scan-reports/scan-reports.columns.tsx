import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { ScanReport } from '@/app/types/payload-types'
import { DateTimeCell } from '@/components/ui/DateTimeCell'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { parseRejectedAssets, totalAssetsInReport } from './service'
import { SCAN_REPORT_STATUS_LABEL, SCAN_REPORT_STATUS_TONE } from './scan-report-labels'

export function getScanReportsColumns(asOrganization?: string): ColumnDef<ScanReport, unknown>[] {
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''
  return [
    {
      accessorKey: 'scan_start',
      header: 'Fecha',
      cell: ({ row }) => <DateTimeCell value={row.original.scan_start} />,
    },
    {
      // Red y gateway en una celda: el gateway sólo tiene sentido como dato de esa red.
      accessorKey: 'network',
      header: 'Red',
      cell: ({ row }) => (
        <Stack gap={2}>
          <TechnicalText>{row.original.network ?? '—'}</TechnicalText>
          {row.original.gateway_ip && (
            <TechnicalText size="xs" c="dimmed">
              Gateway {row.original.gateway_ip}
            </TechnicalText>
          )}
        </Stack>
      ),
    },
    { accessorKey: 'hosts_up', header: 'Hosts detectados', size: 130 },
    {
      // Aceptados y rechazados en una sola columna (antes "Processed" + "Rejected").
      id: 'assets',
      header: 'Activos',
      cell: ({ row }) => {
        const rejected = parseRejectedAssets(row.original.error).length
        if (!row.original.raw_payload) {
          return (
            <Text size="sm" c="dimmed">
              Detalle archivado
            </Text>
          )
        }
        const total = totalAssetsInReport(row.original.raw_payload)
        return (
          <Stack gap={0}>
            <Text size="sm">
              {total - rejected} de {total} aceptados
            </Text>
            {rejected > 0 && (
              <Text size="xs" c="red">
                {rejected} rechazado{rejected === 1 ? '' : 's'}
              </Text>
            )}
          </Stack>
        )
      },
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      size: 130,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const status = row.original.status ?? 'received'
        return (
          <StatusBadge
            tone={SCAN_REPORT_STATUS_TONE[status] ?? 'neutral'}
            label={SCAN_REPORT_STATUS_LABEL[status] ?? status}
          />
        )
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { align: 'center' },
      size: 110,
      cell: ({ row }) => (
        <Group gap={6} wrap="wrap" justify="center">
          <Tooltip label="Ver informe">
            <ActionIcon
              component={Link}
              href={`/portal/inventory/scan-reports/${row.original.id}${suffix}`}
              variant="light"
              size="md"
              aria-label="Ver informe"
            >
              <Eye size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Tooltip>
          <CreateRelatedTaskButton
            compact
            reference={{ relationTo: 'scan-reports', value: String(row.original.id) }}
            asOrganization={asOrganization}
          />
        </Group>
      ),
    },
  ]
}
