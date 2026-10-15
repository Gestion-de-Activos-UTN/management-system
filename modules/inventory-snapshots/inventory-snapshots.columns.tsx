import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { InventorySnapshot } from '@/app/types/payload-types'
import { DateTimeCell } from '@/components/ui/DateTimeCell'
import { portalHref } from '@/lib/portal-href'
import { RenameAction } from '@/components/ui/RenameAction'
import { EVIDENCE_NAME_MAX, evidenceNameError } from '@/modules/scan-reports/schema'
import { useRenameSnapshot } from './hooks/use-snapshot'

function SnapshotRename({ row }: { row: InventorySnapshot }) {
  const rename = useRenameSnapshot(String(row.id))
  return (
    <RenameAction
      value={row.display_name ?? ''}
      fallback="Instantánea"
      maxLength={EVIDENCE_NAME_MAX}
      saving={rename.isPending}
      validate={evidenceNameError}
      onSave={rename.mutateAsync}
    />
  )
}
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'

const GENERATED_BY_LABEL: Record<string, string> = {
  manual: 'Manual',
  scheduled: 'Programada',
  pre_audit: 'Preauditoría',
}

export function getInventorySnapshotsColumns(
  asOrganization?: string,
  canRename = false
): ColumnDef<InventorySnapshot, unknown>[] {
  return [
    {
      accessorKey: 'taken_at',
      header: 'Instantánea',
      // El nombre propio (si lo hay) va primero; la fecha sigue siendo el dato que ordena.
      cell: ({ row }) => (
        <DateTimeCell value={row.original.taken_at} title={row.original.display_name} />
      ),
    },
    {
      accessorKey: 'generated_by',
      header: 'Origen',
      cell: ({ row }) => GENERATED_BY_LABEL[row.original.generated_by] ?? row.original.generated_by,
    },
    {
      id: 'risk_score',
      header: 'Puntaje de riesgo',
      accessorFn: snapshot =>
        (snapshot.assessment_results_snapshot as { score?: number | null })?.score ?? -1,
      cell: ({ row }) => {
        const score = (row.original.assessment_results_snapshot as { score?: number | null })?.score
        return score == null ? (
          <Text size="sm" c="dimmed">
            No evaluable
          </Text>
        ) : (
          Math.round(score)
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
          <Tooltip label="Ver instantánea">
            <ActionIcon
              component={Link}
              href={portalHref(`/portal/inventory/snapshots/${row.original.id}`, asOrganization)}
              variant="light"
              size="md"
              aria-label="Ver instantánea"
            >
              <Eye size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Tooltip>
          {canRename && <SnapshotRename row={row.original} />}
          <CreateRelatedTaskButton
            compact
            reference={{ relationTo: 'inventory-snapshots', value: String(row.original.id) }}
            asOrganization={asOrganization}
          />
        </Group>
      ),
    },
  ]
}
