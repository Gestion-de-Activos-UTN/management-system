'use client';

import { useEffect, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

type FakeUserRow = { name: string; email: string; role: string; status: StatusTone };

// ponytail: static placeholder — the Users collection's `read` access is `() => false` today
// (not just create/update/delete), so there's nothing real to wire until that ships.
const FAKE_ROWS: FakeUserRow[] = [
  { name: 'Ana Torres', email: 'ana@acme.test', role: 'org_admin', status: 'success' },
  { name: 'Luis Prieto', email: 'luis@acme.test', role: 'org_viewer', status: 'success' },
  { name: 'Marta Ibáñez', email: 'marta@acme.test', role: 'org_viewer', status: 'danger' },
];

const columns: ColumnDef<FakeUserRow, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge
        tone={row.original.status}
        label={row.original.status === 'success' ? 'Active' : 'Inactive'}
      />
    ),
  },
];

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 450);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Stack gap="md">
      <PageHeader title="Users" description="Members of your organization." />
      <DataTable columns={columns} data={FAKE_ROWS} isLoading={loading} />
    </Stack>
  );
}
