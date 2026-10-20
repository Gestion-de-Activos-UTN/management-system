import type { ColumnDef } from '@tanstack/react-table'
import { Text, Tooltip } from '@mantine/core'
import type { Organization } from '@/app/types/payload-types'
import { activeStatusColumn } from '@/components/ui/activeStatusColumn'
import { RowActions } from './components/RowActions'

export type OrganizationListRow = Organization & {
  active_office_count: number | null
  active_agent_count: number | null
  online_agent_count: number | null
}

export function getOrganizationsColumns(
  onToggleActive: (organization: Organization) => void,
  onAddOrgAdmin: (organization: Organization) => void
): ColumnDef<OrganizationListRow, unknown>[] {
  return [
    { accessorKey: 'name', header: 'Nombre' },
    {
      accessorKey: 'active_office_count',
      header: 'Oficinas activas',
      size: 150,
      meta: { align: 'center' },
      cell: ({ getValue }) => {
        const count = getValue<number | null>()
        return count == null ? (
          <Text size="sm" c="dimmed">
            —
          </Text>
        ) : (
          count
        )
      },
    },
    {
      id: 'online_agent_count',
      accessorFn: organization => organization.online_agent_count,
      header: 'Escáneres',
      size: 130,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const { active_agent_count: active, online_agent_count: online } = row.original
        if (active == null || online == null) {
          return (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )
        }
        return (
          <Tooltip label="Conectados / activos">
            <Text size="sm" aria-label={`${online} conectados de ${active} activos`}>
              {online} / {active}
            </Text>
          </Tooltip>
        )
      },
    },
    activeStatusColumn<OrganizationListRow>(org => Boolean(org.is_active)),
    {
      id: 'actions',
      header: 'Acciones',
      meta: { align: 'center' },
      size: 110,
      cell: ({ row }) => (
        <RowActions
          organization={row.original}
          onToggleActive={onToggleActive}
          onAddOrgAdmin={onAddOrgAdmin}
        />
      ),
    },
  ]
}
