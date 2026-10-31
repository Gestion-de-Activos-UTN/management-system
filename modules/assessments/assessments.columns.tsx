import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Anchor, Checkbox, Group, Stack, Text, Tooltip } from '@mantine/core'
import { relationId } from '@/lib/relationId'
import classes from './assessments.module.css'
import { ClipboardCheck } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format-date'
import { portalHref } from '@/lib/portal-href'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { ASSESSMENT_STATUS_LABEL, ASSESSMENT_STATUS_TONE } from './assessment-labels'
import type { AssessmentGroup } from './assessment-groups'
import type { BulkAssessmentPreviewResponse } from './service'

export type BulkCandidate = BulkAssessmentPreviewResponse['applicable'][number]

/** Revisiones candidatas de "Responder varias": la primera columna marca cuáles se completan. */
export function getBulkSelectionColumns({
  selected,
  visibleIds,
  onToggle,
  onToggleAll,
  officeName,
  ownerName,
}: {
  selected: ReadonlySet<string>
  visibleIds: string[]
  onToggle: (id: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  officeName: (id: string | null | undefined) => string
  ownerName: (id: string | null | undefined) => string
}): ColumnDef<BulkCandidate, unknown>[] {
  const visibleSelected = visibleIds.filter(id => selected.has(id)).length
  return [
    {
      id: 'select',
      header: () => (
        <Checkbox
          aria-label="Seleccionar todas las revisiones visibles"
          checked={visibleIds.length > 0 && visibleSelected === visibleIds.length}
          indeterminate={visibleSelected > 0 && visibleSelected < visibleIds.length}
          onChange={event => onToggleAll(event.currentTarget.checked)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Incluir ${row.original.asset_label}`}
          checked={selected.has(row.original.assessment_id)}
          onChange={event => onToggle(row.original.assessment_id, event.currentTarget.checked)}
        />
      ),
    },
    {
      accessorKey: 'asset_label',
      header: 'Activo',
      cell: ({ row }) => (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            {row.original.asset_label}
          </Text>
          <Text size="xs" c="dimmed">
            {row.original.asset_source === 'manual' ? 'Activo manual' : 'Detectado por escáner'}
          </Text>
        </Stack>
      ),
    },
    {
      id: 'office',
      header: 'Oficina',
      cell: ({ row }) => <Text size="sm">{officeName(row.original.office_id)}</Text>,
    },
    {
      id: 'owner',
      header: 'Responsable',
      cell: ({ row }) => <Text size="sm">{ownerName(row.original.owner_id)}</Text>,
    },
    {
      id: 'draft',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.has_draft ? (
          <StatusBadge tone="info" label="Borrador existente" />
        ) : (
          <StatusBadge tone="neutral" label="Sin iniciar" />
        ),
    },
  ]
}

/** Revisiones de dispositivos (pestaña "Dispositivos" de Revisión de seguridad): una fila por activo. */
export function getDeviceReviewColumns(
  asOrganization?: string
): ColumnDef<AssessmentGroup, unknown>[] {
  return [
    {
      accessorKey: 'target',
      header: 'Dispositivo',
      cell: ({ row }) => {
        const latest = row.original.cycles[0]
        const asset = latest.manual_asset || latest.asset
        const href = asset
          ? latest.manual_asset
            ? portalHref(
                '/portal/inventory',
                asOrganization,
                `nonNetworkAsset=${encodeURIComponent(relationId(asset))}`
              )
            : portalHref(
                `/portal/inventory/${encodeURIComponent(relationId(asset))}`,
                asOrganization
              )
          : null
        return (
          <Stack gap={0}>
            {href ? (
              <Anchor
                component={Link}
                href={href}
                size="sm"
                fw={600}
                c="inherit"
                underline="never"
                className={classes.deviceLink}
              >
                {row.original.target}
              </Anchor>
            ) : (
              <Text size="sm" fw={600}>
                {row.original.target}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {row.original.manuallyEntered ? 'Activo manual' : 'Detectado por escáner'}
            </Text>
          </Stack>
        )
      },
    },
    {
      id: 'status',
      header: 'Estado',
      accessorFn: group => ASSESSMENT_STATUS_LABEL[group.cycles[0].status],
      cell: ({ row }) => (
        <StatusBadge
          tone={ASSESSMENT_STATUS_TONE[row.original.cycles[0].status]}
          label={ASSESSMENT_STATUS_LABEL[row.original.cycles[0].status]}
        />
      ),
    },
    {
      id: 'opened_at',
      header: 'Ciclo actual',
      accessorFn: group => group.cycles[0].opened_at,
      cell: ({ row }) => (
        <Text size="sm">
          Ciclo {row.original.cycles.length} · {formatDate(row.original.cycles[0].opened_at)}
        </Text>
      ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      meta: { align: 'center' },
      size: 110,
      cell: ({ row }) => {
        const latest = row.original.cycles[0]
        return (
          <Group gap={6} wrap="wrap" justify="center">
            <Tooltip label="Abrir revisión">
              <ActionIcon
                component={Link}
                href={portalHref(`/portal/security-review/${latest.id}`, asOrganization)}
                variant="light"
                size="md"
                aria-label="Abrir revisión"
              >
                <ClipboardCheck size={16} strokeWidth={1.5} />
              </ActionIcon>
            </Tooltip>
            <CreateRelatedTaskButton
              compact
              reference={{ relationTo: 'assessment-instances', value: String(latest.id) }}
              asOrganization={asOrganization}
            />
          </Group>
        )
      },
    },
  ]
}
