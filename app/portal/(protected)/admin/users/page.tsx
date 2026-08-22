'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useOrgMembers } from '@/modules/users/hooks/use-org-members';
import type { OrgMember } from '@/modules/users/service';

const columns: ColumnDef<OrgMember, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge
        tone={row.original.status === 'active' ? 'success' : 'warning'}
        label={row.original.status === 'active' ? 'Active' : 'Onboarding'}
      />
    ),
  },
];

export default function AdminUsersPage() {
  const { data: members, isPending } = useOrgMembers();

  return (
    <Stack gap="md">
      <PageHeader title="Users" description="Members of your organization." />
      <DataTable columns={columns} data={members ?? []} isLoading={isPending} />
    </Stack>
  );
}
