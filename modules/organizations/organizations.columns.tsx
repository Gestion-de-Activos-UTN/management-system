import type { ColumnDef } from '@tanstack/react-table'
import type { Organization } from '@/app/types/payload-types'
import { activeStatusColumn } from '@/components/ui/activeStatusColumn'
import { RowActions } from './components/RowActions'

export function getOrganizationsColumns(
  onToggleActive: (organization: Organization) => void
): ColumnDef<Organization, unknown>[] {
  return [
    { accessorKey: 'name', header: 'Nombre' },
    activeStatusColumn<Organization>(org => Boolean(org.is_active)),
    {
      id: 'actions',
      header: 'Acciones',
      meta: { align: 'center' },
      size: 110,
      cell: ({ row }) => <RowActions organization={row.original} onToggleActive={onToggleActive} />,
    },
  ]
}
