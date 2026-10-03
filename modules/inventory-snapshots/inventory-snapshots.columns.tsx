import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { InventorySnapshot } from '@/app/types/payload-types'
import { DateTimeCell } from '@/components/ui/DateTimeCell'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'

const GENERATED_BY_LABEL: Record<string, string> = {
  manual: 'Manual',
  scheduled: 'Programada',
  pre_audit: 'Preauditoría',
}

export function getInventorySnapshotsColumns(
  asOrganization?: string
): ColumnDef<InventorySnapshot, unknown>[] {
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''
  return [
    {
      accessorKey: 'taken_at',
      header: 'Fecha',
      cell: ({ row }) => <DateTimeCell value={row.original.taken_at} />,
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
      size: 110,
      cell: ({ row }) => (
        <Group gap={6} wrap="wrap" justify="center">
          <Tooltip label="Ver instantánea">
            <ActionIcon
              component={Link}
              href={`/portal/inventory/snapshots/${row.original.id}${suffix}`}
              variant="light"
              size="md"
              aria-label="Ver instantánea"
            >
              <Eye size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Tooltip>
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
