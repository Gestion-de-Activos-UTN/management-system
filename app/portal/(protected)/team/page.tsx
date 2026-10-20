'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Stack, Text } from '@mantine/core'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { roleSlugLabel } from '@/lib/role-labels'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { MemberCreateModal } from '@/modules/users/components/MemberCreateModal'
import { useCreateOrgMember, useOrgMembers } from '@/modules/users/hooks/use-org-members'
import type { OrgMember } from '@/modules/users/service'

export default function TeamPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: members, isPending } = useOrgMembers(asOrganization)
  const { data: offices } = useOfficesList(asOrganization)
  const [creating, setCreating] = useState(false)
  const create = useCreateOrgMember(asOrganization)
  const officeOptions = (offices ?? []).map(office => ({
    value: String(office.id),
    label: office.name,
  }))
  const columns: ColumnDef<OrgMember, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Persona',
      cell: ({ row }) => (
        <Stack gap={0}>
          <Text size="sm" fw={600}>
            {row.original.name || row.original.email}
          </Text>
          {row.original.name && (
            <Text size="xs" c="dimmed">
              {row.original.email}
            </Text>
          )}
        </Stack>
      ),
    },
    { accessorKey: 'role', header: 'Rol', cell: ({ row }) => roleSlugLabel(row.original.role) },
    {
      id: 'offices',
      header: 'Oficinas',
      cell: ({ row }) =>
        row.original.office_ids
          .map(id => officeOptions.find(office => office.value === id)?.label)
          .filter(Boolean)
          .join(', ') || '—',
    },
  ]
  return (
    <Stack gap="md">
      <PageHeader
        title="Equipo"
        description="Personas con acceso a tus oficinas."
        rightSection={<Button onClick={() => setCreating(true)}>Crear Viewer</Button>}
      />
      <DataTable
        columns={columns}
        data={members ?? []}
        isLoading={isPending}
        emptyLabel="No hay personas visibles"
        minWidth={600}
      />
      <MemberCreateModal
        opened={creating}
        onClose={() => setCreating(false)}
        officeOptions={officeOptions}
        roles={['org_viewer']}
        lockedRole="org_viewer"
        onSubmit={input => create.mutateAsync(input)}
        isPending={create.isPending}
      />
    </Stack>
  )
}
