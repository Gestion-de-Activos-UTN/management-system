import type { ColumnDef } from '@tanstack/react-table';
import type { Office } from '@/app/types/payload-types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TechnicalText } from '@/components/ui/TechnicalText';

function organizationLabel(office: Office) {
  return typeof office.organization === 'object'
    ? office.organization.name
    : String(office.organization);
}

export const officesColumns: ColumnDef<Office, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'organization', header: 'Organization', cell: ({ row }) => organizationLabel(row.original) },
  {
    accessorKey: 'county_fips',
    header: 'County FIPS',
    size: 150,
    cell: ({ row }) => row.original.county_fips && <TechnicalText>{row.original.county_fips}</TechnicalText>,
  },
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
];
