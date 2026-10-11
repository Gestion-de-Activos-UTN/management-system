'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import type { OrgMember } from '@/modules/users/service'
import { roleSlugLabel } from '@/lib/role-labels'

const columns: ColumnDef<OrgMember, unknown>[] = [
  { accessorKey: 'name', header: 'Nombre' },
  { accessorKey: 'email', header: 'Correo electrónico' },
  {
    accessorKey: 'role',
    header: 'Rol',
    cell: ({ row }) => roleSlugLabel(row.original.role),
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => (
      <StatusBadge
        tone={row.original.status === 'active' ? 'success' : 'warning'}
        label={row.original.status === 'active' ? 'Activo' : 'Incorporación'}
      />
    ),
  },
]

export default function AdminUsersPage() {
  const { data: members, isPending } = useOrgMembers()

  return (
    <Stack gap="md">
      <PageHeader title="Usuarios" description="Miembros de tu organización." />
      <DataTable columns={columns} data={members ?? []} isLoading={isPending} minWidth={760} />
    </Stack>
  )
}
