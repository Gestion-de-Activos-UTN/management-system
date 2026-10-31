import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Group, Stack, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { ScanReport } from '@/app/types/payload-types'
import { OneLineText } from '@/components/ui/OneLineText'
import { DateTimeCell } from '@/components/ui/DateTimeCell'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { parseRejectedAssets, totalAssetsInReport } from './service'
import {
  SCAN_EXECUTION_DESCRIPTION,
  SCAN_REPORT_STATUS_LABEL,
  SCAN_REPORT_STATUS_TONE,
} from './scan-report-labels'
import { portalHref } from '@/lib/portal-href'
import { RenameAction } from '@/components/ui/RenameAction'
import { EVIDENCE_NAME_MAX, evidenceNameError } from './schema'
import { useRenameScanReport } from './hooks/use-scan-report'

function ScanReportRename({ row }: { row: ScanReport }) {
  const rename = useRenameScanReport(String(row.id))
  return (
    <RenameAction
      value={row.display_name ?? ''}
      fallback="Informe de escaneo"
      maxLength={EVIDENCE_NAME_MAX}
      saving={rename.isPending}
      validate={evidenceNameError}
      onSave={rename.mutateAsync}
    />
  )
}

export function getScanReportsColumns(
  asOrganization?: string,
  canRename = false
): ColumnDef<ScanReport, unknown>[] {
  return [
    {
      accessorKey: 'scan_start',
      header: 'Escaneo',
      // El nombre propio (si lo hay) va primero; la fecha sigue siendo el dato que ordena.
      cell: ({ row }) => (
        <DateTimeCell value={row.original.scan_start} title={row.original.display_name} />
      ),
    },
    {
      // Red y gateway en una celda: el gateway sólo tiene sentido como dato de esa red.
      accessorKey: 'network',
      header: 'Red',
      cell: ({ row }) => (
        <Stack gap={2}>
          <OneLineText ff="monospace">{row.original.network ?? '—'}</OneLineText>
          {row.original.gateway_ip && (
            <OneLineText ff="monospace" size="xs" c="dimmed">
              {`Gateway ${row.original.gateway_ip}`}
            </OneLineText>
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
          return <OneLineText c="dimmed">Detalle archivado</OneLineText>
        }
        const total = totalAssetsInReport(row.original.raw_payload)
        return (
          <Stack gap={0}>
            <OneLineText>{`${total - rejected} de ${total} aceptados`}</OneLineText>
            {rejected > 0 && (
              <OneLineText size="xs" c="red">
                {`${rejected} rechazado${rejected === 1 ? '' : 's'}`}
              </OneLineText>
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
        const execution = row.original.execution_status ?? ''
        return (
          <Tooltip
            multiline
            w={260}
            label={SCAN_EXECUTION_DESCRIPTION[execution] ?? ''}
            disabled={!SCAN_EXECUTION_DESCRIPTION[execution]}
          >
            <span>
              <StatusBadge
                tone={SCAN_REPORT_STATUS_TONE[status] ?? 'neutral'}
                label={SCAN_REPORT_STATUS_LABEL[status] ?? status}
              />
            </span>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { align: 'center' },
      size: 140,
      cell: ({ row }) => (
        <Group gap={6} wrap="wrap" justify="center">
          <Tooltip label="Ver informe">
            <ActionIcon
              component={Link}
              href={portalHref(`/portal/inventory/scan-reports/${row.original.id}`, asOrganization)}
              variant="light"
              size="md"
              aria-label="Ver informe"
            >
              <Eye size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Tooltip>
          {canRename && <ScanReportRename row={row.original} />}
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
