import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@mantine/core';
import type { Organization } from '@/app/types/payload-types';
import { StatusBadge } from '@/components/ui/StatusBadge';

export const organizationsColumns: ColumnDef<Organization, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'is_active',
    header: 'Status',
    size: 130,
    cell: ({ row }) =>
      row.original.is_active ? (
        <StatusBadge tone="success" label="Active" />
      ) : (
        <StatusBadge tone="danger" label="Inactive" />
      ),
  },
  {
    id: 'actions',
    header: '',
    size: 110,
    cell: ({ row }) => (
      <Button
        component={Link}
        href={`/portal/dashboard?asOrganization=${row.original.id}`}
        size="xs"
        variant="light"
      >
        Visit
      </Button>
    ),
  },
];
