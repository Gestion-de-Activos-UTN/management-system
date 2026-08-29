'use client';

import { useParams, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, Center, Loader, SimpleGrid, Stack, Tabs, Text } from '@mantine/core';
import { Network, Radar, CircleCheck, CircleX } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { BackButton } from '@/components/ui/BackButton';
import { TechnicalText } from '@/components/ui/TechnicalText';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/format-date';
import { relationId } from '@/lib/relationId';
import { useScanReport } from '@/modules/scan-reports/hooks/use-scan-report';
import {
  acceptedAssetsInReport,
  parseRejectedAssets,
  totalAssetsInReport,
  type RejectedAsset,
  type ReportedAsset,
} from '@/modules/scan-reports/service';

const STATUS_TONE: Record<string, StatusTone> = {
  received: 'neutral',
  processed: 'success',
  failed: 'danger',
};

const acceptedColumns: ColumnDef<ReportedAsset, unknown>[] = [
  { accessorKey: 'asset_id', header: 'Asset ID', cell: ({ row }) => <TechnicalText>{row.original.asset_id}</TechnicalText> },
  { accessorKey: 'ip', header: 'IP', cell: ({ row }) => <TechnicalText>{row.original.ip}</TechnicalText> },
  { accessorKey: 'hostname', header: 'Hostname', cell: ({ row }) => row.original.hostname || '—' },
  { accessorKey: 'mac', header: 'MAC', cell: ({ row }) => <TechnicalText>{row.original.mac || '—'}</TechnicalText> },
];

const rejectedColumns: ColumnDef<RejectedAsset, unknown>[] = [
  { accessorKey: 'asset_id', header: 'Asset ID', cell: ({ row }) => <TechnicalText>{row.original.asset_id}</TechnicalText> },
  { accessorKey: 'error', header: 'Reason' },
];

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        {icon}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="xl" fw={700}>
            {value}
          </Text>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}

export default function ScanReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const backHref = `/portal/inventory/scan-reports${asOrganization ? `?asOrganization=${asOrganization}` : ''}`;
  const { data: report, isPending } = useScanReport(id);

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    );
  }

  if (!report) {
    return (
      <Center py="xl">
        <Text c="dimmed">Could not load this scan report.</Text>
      </Center>
    );
  }

  const total = totalAssetsInReport(report.raw_payload);
  const rejected = parseRejectedAssets(report.error);
  const accepted = acceptedAssetsInReport(report.raw_payload, rejected);
  const status = report.status ?? 'received';

  return (
    <Stack gap="lg">
      <BackButton href={backHref} label="Back to Scan Reports" />

      <PageHeader
        title={`Scan Report — ${report.scan_start ? formatDateTime(report.scan_start) : report.id}`}
        description={`Sent by agent ${relationId(report.agent)}${report.scan_end ? ` · finished ${formatDateTime(report.scan_end)}` : ''}.`}
        rightSection={<StatusBadge tone={STATUS_TONE[status] ?? 'neutral'} label={status} />}
      />

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
        <StatCard icon={<Network size={20} strokeWidth={1.5} />} value={report.network ?? '—'} label="Network" />
        <StatCard icon={<Radar size={20} strokeWidth={1.5} />} value={report.hosts_up ?? total} label="Hosts detected" />
        <StatCard icon={<CircleCheck size={20} strokeWidth={1.5} />} value={`${accepted.length} / ${total}`} label="Accepted" />
        <StatCard icon={<CircleX size={20} strokeWidth={1.5} />} value={rejected.length} label="Rejected" />
      </SimpleGrid>

      <Tabs defaultValue="accepted">
        <Tabs.List>
          <Tabs.Tab value="accepted">Accepted ({accepted.length})</Tabs.Tab>
          <Tabs.Tab value="rejected">Rejected ({rejected.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="accepted" pt="md">
          <DataTable
            columns={acceptedColumns}
            data={accepted}
            emptyLabel="Nothing was accepted in this report"
            minWidth={720}
          />
        </Tabs.Panel>

        <Tabs.Panel value="rejected" pt="md">
          <DataTable
            columns={rejectedColumns}
            data={rejected}
            emptyLabel="Nothing was rejected in this report"
            minWidth={520}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
