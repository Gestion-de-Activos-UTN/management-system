import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Eye } from 'lucide-react';
import type { InventorySnapshot } from '@/app/types/payload-types';
import { formatDateTime } from '@/lib/format-date';

const GENERATED_BY_LABEL: Record<string, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  pre_audit: 'Pre-audit',
};

export const inventorySnapshotsColumns: ColumnDef<InventorySnapshot, unknown>[] = [
  {
    accessorKey: 'taken_at',
    header: 'Date',
    cell: ({ row }) => formatDateTime(row.original.taken_at),
  },
  {
    accessorKey: 'generated_by',
    header: 'Source',
    cell: ({ row }) => GENERATED_BY_LABEL[row.original.generated_by] ?? row.original.generated_by,
  },
  {
    accessorKey: 'risk_score',
    header: 'Risk Score',
    cell: ({ row }) => row.original.risk_score?.global ?? '—',
  },
  {
    id: 'actions',
    header: '',
    size: 48,
    cell: ({ row }) => (
      <Tooltip label="View snapshot">
        <ActionIcon component={Link} href={`/portal/inventory/snapshots/${row.original.id}`} variant="light" size="md">
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    ),
  },
];
