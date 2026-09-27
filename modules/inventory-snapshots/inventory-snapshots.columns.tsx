import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { InventorySnapshot } from '@/app/types/payload-types'
import { formatDateTime } from '@/lib/format-date'

const GENERATED_BY_LABEL: Record<string, string> = {
  manual: 'Manual',
  scheduled: 'Programada',
  pre_audit: 'Preauditoría',
}

export const inventorySnapshotsColumns: ColumnDef<InventorySnapshot, unknown>[] = [
  {
    accessorKey: 'taken_at',
    header: 'Fecha',
    cell: ({ row }) => formatDateTime(row.original.taken_at),
  },
  {
    accessorKey: 'generated_by',
    header: 'Origen',
    cell: ({ row }) => GENERATED_BY_LABEL[row.original.generated_by] ?? row.original.generated_by,
  },
  {
    accessorKey: 'risk_score',
    header: 'Puntaje de riesgo',
    cell: ({ row }) => {
      const score = (row.original.assessment_results_snapshot as { score?: number | null })?.score
      return score == null ? 'No evaluable' : Math.round(score)
    },
  },
  {
    id: 'actions',
    header: '',
    size: 48,
    cell: ({ row }) => (
      <Tooltip label="Ver instantánea">
        <ActionIcon
          component={Link}
          href={`/portal/inventory/snapshots/${row.original.id}`}
          variant="light"
          size="md"
        >
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    ),
  },
]
