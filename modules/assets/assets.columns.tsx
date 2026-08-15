import type { ColumnDef } from '@tanstack/react-table';
import type { Asset } from '@/app/types/payload-types';
import { TechnicalText } from '@/components/ui/TechnicalText';

export const assetsColumns: ColumnDef<Asset, unknown>[] = [
  { accessorKey: 'alias', header: 'Alias' },
  {
    accessorKey: 'ip',
    header: 'IP',
    size: 140,
    cell: ({ row }) => row.original.ip && <TechnicalText>{row.original.ip}</TechnicalText>,
  },
  {
    accessorKey: 'hostname',
    header: 'Hostname',
    cell: ({ row }) => row.original.hostname && <TechnicalText>{row.original.hostname}</TechnicalText>,
  },
  { accessorKey: 'criticality', header: 'Criticality', size: 140 },
  { accessorKey: 'location', header: 'Location' },
];
