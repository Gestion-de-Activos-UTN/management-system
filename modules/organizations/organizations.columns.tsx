import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@mantine/core';
import type { Organization } from '@/app/types/payload-types';
import { activeStatusColumn } from '@/components/ui/activeStatusColumn';

export const organizationsColumns: ColumnDef<Organization, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  activeStatusColumn<Organization>((org) => Boolean(org.is_active)),
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
        w={{ base: '100%', sm: 'auto' }}
      >
        Visit
      </Button>
    ),
  },
];
