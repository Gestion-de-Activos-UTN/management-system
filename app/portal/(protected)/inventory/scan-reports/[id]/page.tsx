'use client'

import { useParams, useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Center, Loader, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { Network, Radar, CircleCheck, CircleX } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { BackButton } from '@/components/ui/BackButton'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  SCAN_DISCOVERY_DESCRIPTION,
  SCAN_EXECUTION_DESCRIPTION,
  SCAN_RUN_LABEL,
  SCAN_REPORT_STATUS_LABEL,
  SCAN_REPORT_STATUS_TONE,
} from '@/modules/scan-reports/scan-report-labels'
import { formatScanWindow } from '@/lib/format-date'
import { relationId } from '@/lib/relationId'
import { useRenameScanReport, useScanReport } from '@/modules/scan-reports/hooks/use-scan-report'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { EVIDENCE_NAME_MAX, evidenceNameError } from '@/modules/scan-reports/schema'
import { EditableTitle } from '@/components/ui/EditableTitle'
import {
  acceptedAssetsInReport,
  parseRejectedAssets,
  totalAssetsInReport,
  type RejectedAsset,
  type ReportedAsset,
} from '@/modules/scan-reports/service'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { portalHref } from '@/lib/portal-href'

const acceptedColumns: ColumnDef<ReportedAsset, unknown>[] = [
  {
    accessorKey: 'asset_id',
    header: 'ID del activo',
    cell: ({ row }) => <TechnicalText>{row.original.asset_id}</TechnicalText>,
  },
  {
    accessorKey: 'ip',
    header: 'IP',
    cell: ({ row }) => <TechnicalText>{row.original.ip}</TechnicalText>,
  },
  {
    accessorKey: 'hostname',
    header: 'Nombre del host',
    cell: ({ row }) => <TechnicalText>{row.original.hostname || '—'}</TechnicalText>,
  },
  {
    accessorKey: 'mac',
    header: 'MAC',
    cell: ({ row }) => <TechnicalText>{row.original.mac || '—'}</TechnicalText>,
  },
]

const rejectedColumns: ColumnDef<RejectedAsset, unknown>[] = [
  {
    accessorKey: 'asset_id',
    header: 'ID del activo',
    cell: ({ row }) => <TechnicalText>{row.original.asset_id}</TechnicalText>,
  },
  { accessorKey: 'error', header: 'Motivo' },
]

export default function ScanReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const backHref = portalHref('/portal/inventory/scan-reports', asOrganization)
  const { data: report, isPending } = useScanReport(id)
  const rename = useRenameScanReport(id)
  const tenant = useTenantContext(asOrganization)

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  }

  if (!report) {
    return (
      <Center py="xl">
        <Text c="dimmed">No se pudo cargar este informe de escaneo.</Text>
      </Center>
    )
  }

  const payloadArchived = !report.raw_payload
  const total = payloadArchived ? (report.hosts_up ?? 0) : totalAssetsInReport(report.raw_payload)
  const rejected = parseRejectedAssets(report.error)
  const accepted = acceptedAssetsInReport(report.raw_payload, rejected)
  const status = report.status ?? 'received'
  const discoveryStatus =
    (report.report_coverage as { discovery?: { status?: string } } | null)?.discovery?.status ??
    'unknown'
  const officeName =
    report.office && typeof report.office === 'object' ? report.office.name : 'la oficina'

  return (
    <Stack gap="lg">
      <BackButton href={backHref} label="Volver a Informes de escaneo" />

      <PageHeader
        title={
          <EditableTitle
            value={report.display_name ?? ''}
            fallback="Informe de escaneo"
            canEdit={Boolean(tenant.data?.permissions.renameEvidence)}
            saving={rename.isPending}
            maxLength={EVIDENCE_NAME_MAX}
            validate={evidenceNameError}
            onSave={rename.mutateAsync}
          />
        }
        badge={
          <Tooltip
            multiline
            w={260}
            label={SCAN_EXECUTION_DESCRIPTION[report.execution_status ?? ''] ?? ''}
            disabled={!report.execution_status}
          >
            <span>
              <StatusBadge
                tone={SCAN_REPORT_STATUS_TONE[status] ?? 'neutral'}
                label={SCAN_REPORT_STATUS_LABEL[status] ?? status}
              />
            </span>
          </Tooltip>
        }
        // Una sola mención de fecha y hora, también cuando el informe tiene nombre propio.
        description={
          <>
            {report.scan_start ? formatScanWindow(report.scan_start, report.scan_end) : 'Sin fecha'}
            {' · '}
            <Tooltip label={`Agente ${relationId(report.agent)}`}>
              <span>Escáner de {officeName}</span>
            </Tooltip>
          </>
        }
        rightSection={
          <CreateRelatedTaskButton
            reference={{ relationTo: 'scan-reports', value: String(report.id) }}
            asOrganization={asOrganization}
          />
        }
      />

      <Stack gap={2}>
        {report.execution_status && (
          <Text size="sm">{SCAN_EXECUTION_DESCRIPTION[report.execution_status]}</Text>
        )}
        <Text size="xs" c="dimmed">
          Búsqueda de equipos: {SCAN_RUN_LABEL[discoveryStatus] ?? 'desconocida'}
          {SCAN_DISCOVERY_DESCRIPTION[discoveryStatus]
            ? ` — ${SCAN_DISCOVERY_DESCRIPTION[discoveryStatus]}`
            : ''}
        </Text>
      </Stack>

      <MetricsStrip
        isPending={false}
        metrics={[
          { key: 'network', icon: Network, value: report.network ?? '—', label: 'red' },
          { key: 'hosts', icon: Radar, value: report.hosts_up ?? total, label: 'hosts detectados' },
          {
            key: 'accepted',
            icon: CircleCheck,
            value: payloadArchived ? 'Archivado' : `${accepted.length} / ${total}`,
            label: 'aceptados',
          },
          { key: 'rejected', icon: CircleX, value: rejected.length, label: 'rechazados' },
        ]}
      />

      <Tabs defaultValue="accepted">
        <Tabs.List>
          <Tabs.Tab value="accepted" leftSection={<CircleCheck size={16} strokeWidth={1.5} />}>
            Aceptados ({accepted.length})
          </Tabs.Tab>
          <Tabs.Tab value="rejected" leftSection={<CircleX size={16} strokeWidth={1.5} />}>
            Rechazados ({rejected.length})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="accepted" pt="md">
          {payloadArchived && (
            <Text c="dimmed" mb="md">
              La lista original de activos venció según la política de retención; los metadatos y la
              cobertura del informe siguen disponibles.
            </Text>
          )}
          <DataTable
            columns={acceptedColumns}
            data={accepted}
            emptyLabel="No se aceptó ningún elemento en este informe"
            minWidth={720}
          />
        </Tabs.Panel>

        <Tabs.Panel value="rejected" pt="md">
          <DataTable
            columns={rejectedColumns}
            data={rejected}
            emptyLabel="No se rechazó ningún elemento en este informe"
            minWidth={520}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
