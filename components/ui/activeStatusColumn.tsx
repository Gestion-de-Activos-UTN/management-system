import type { ColumnDef } from '@tanstack/react-table';
import { StatusBadge } from './StatusBadge';

export function activeStatusColumn<T>(
  accessor: (row: T) => boolean,
  labels: { true: string; false: string } = { true: 'Active', false: 'Inactive' },
): ColumnDef<T, unknown> {
  return {
    accessorKey: 'is_active',
    header: 'Status',
    size: 130,
    cell: ({ row }) =>
      accessor(row.original) ? (
        <StatusBadge tone="success" label={labels.true} />
      ) : (
        <StatusBadge tone="danger" label={labels.false} />
      ),
  };
}
