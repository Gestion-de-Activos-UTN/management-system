import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Eye } from 'lucide-react';
import type { ScanReport } from '@/app/types/payload-types';
import { formatDateTime } from '@/lib/format-date';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { parseRejectedAssets, totalAssetsInReport } from './service';

const STATUS_TONE: Record<string, StatusTone> = {
  received: 'neutral',
  processed: 'success',
  failed: 'danger',
};

export const scanReportsColumns: ColumnDef<ScanReport, unknown>[] = [
  {
    accessorKey: 'scan_start',
    header: 'Date',
    cell: ({ row }) => (row.original.scan_start ? formatDateTime(row.original.scan_start) : '—'),
  },
  { accessorKey: 'network', header: 'Network' },
  {
    accessorKey: 'gateway_ip',
    header: 'Gateway',
    cell: ({ row }) => row.original.gateway_ip ?? '—',
  },
  { accessorKey: 'hosts_up', header: 'Hosts detected' },
  {
    id: 'processed',
    header: 'Processed',
    cell: ({ row }) => {
      const total = totalAssetsInReport(row.original.raw_payload);
      const rejected = parseRejectedAssets(row.original.error).length;
      return `${total - rejected} / ${total}`;
    },
  },
  {
    id: 'rejected',
    header: 'Rejected',
    cell: ({ row }) => parseRejectedAssets(row.original.error).length,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: { align: 'center' },
    cell: ({ row }) => {
      const status = row.original.status ?? 'received';
      return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'} label={status} />;
    },
  },
  {
    id: 'actions',
    header: '',
    size: 48,
    cell: ({ row }) => (
      <Tooltip label="View report">
        <ActionIcon component={Link} href={`/portal/inventory/scan-reports/${row.original.id}`} variant="light" size="md">
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    ),
  },
];
