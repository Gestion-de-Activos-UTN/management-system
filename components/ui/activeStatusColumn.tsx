import type { ColumnDef } from '@tanstack/react-table'
import { StatusBadge } from './StatusBadge'

export function activeStatusColumn<T>(
  accessor: (row: T) => boolean,
  labels: { true: string; false: string } = { true: 'Activo', false: 'Inactivo' }
): ColumnDef<T, unknown> {
  return {
    accessorKey: 'is_active',
    header: 'Estado',
    size: 130,
    meta: { align: 'center' },
    cell: ({ row }) =>
      accessor(row.original) ? (
        <StatusBadge tone="success" label={labels.true} />
      ) : (
        <StatusBadge tone="danger" label={labels.false} />
      ),
  }
}
