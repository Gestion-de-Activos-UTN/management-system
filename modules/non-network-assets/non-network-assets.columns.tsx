import type { ColumnDef } from '@tanstack/react-table';
import type { NonNetworkAsset } from '@/app/types/payload-types';
import { ASSET_CATEGORY_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels';
import { formatDate } from '@/lib/format-date';
import { ReviewStatusBadge } from './components/ReviewStatusBadge';
import { RowActions } from './components/RowActions';

export function getNonNetworkAssetsColumns(
  onEdit: (asset: NonNetworkAsset) => void,
  // Users.read is () => false by design (see modules/users/service.ts) — a plain `depth=1`
  // list request can't populate `owner` past its raw id (Payload's own access check on the
  // related collection blocks it, falling back to the id string). Resolve the display name
  // from the already-fetched org-members list instead of depending on relationship population.
  ownerNameById: Record<string, string>,
): ColumnDef<NonNetworkAsset, unknown>[] {
  return [
    { accessorKey: 'alias', header: 'Alias' },
    {
      accessorKey: 'asset_category',
      header: 'Category',
      cell: ({ row }) => ASSET_CATEGORY_LABEL[row.original.asset_category] ?? row.original.asset_category,
    },
    {
      accessorKey: 'criticality',
      header: 'Criticality',
      cell: ({ row }) => CRITICALITY_LABEL[row.original.criticality] ?? row.original.criticality,
    },
    {
      accessorKey: 'office',
      header: 'Office',
      cell: ({ row }) => {
        const office = row.original.office;
        return typeof office === 'object' && office ? office.name : '—';
      },
    },
    {
      accessorKey: 'owner',
      header: 'Owner',
      cell: ({ row }) => {
        const owner = row.original.owner;
        if (typeof owner === 'object' && owner) return owner.name;
        return (owner && ownerNameById[owner]) || '—';
      },
    },
    {
      accessorKey: 'next_review_at',
      header: 'Next review',
      cell: ({ row }) =>
        row.original.next_review_at ? formatDate(row.original.next_review_at) : '—',
    },
    {
      accessorKey: 'review_status',
      header: 'Review',
      cell: ({ row }) => <ReviewStatusBadge reviewStatus={row.original.review_status} />,
    },
    {
      id: 'actions',
      header: '',
      size: 84,
      cell: ({ row }) => <RowActions asset={row.original} onEdit={onEdit} />,
    },
  ];
}
