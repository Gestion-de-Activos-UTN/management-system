'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Card, Center, Group, Loader, RingProgress, Stack, Tabs, Text } from '@mantine/core';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { BackButton } from '@/components/ui/BackButton';
import { TechnicalText } from '@/components/ui/TechnicalText';
import { useSnapshot } from '@/modules/inventory-snapshots/hooks/use-snapshot';
import { formatDateTime } from '@/lib/format-date';
import { ASSET_CATEGORY_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels';

type DumpedAsset = {
  id?: string;
  ip?: string;
  hostname?: string;
  alias?: string;
  criticality?: string;
  status?: string;
};

type DumpedNonNetworkAsset = {
  id?: string;
  alias?: string;
  asset_category?: string;
  criticality?: string;
  status?: string;
};

const networkColumns: ColumnDef<DumpedAsset, unknown>[] = [
  { accessorKey: 'alias', header: 'Alias' },
  { accessorKey: 'ip', header: 'IP', cell: ({ row }) => <TechnicalText>{row.original.ip ?? '—'}</TechnicalText> },
  { accessorKey: 'hostname', header: 'Hostname' },
  {
    accessorKey: 'criticality',
    header: 'Criticality',
    cell: ({ row }) => (row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—'),
  },
  { accessorKey: 'status', header: 'Status (at snapshot time)' },
];

const nonNetworkColumns: ColumnDef<DumpedNonNetworkAsset, unknown>[] = [
  { accessorKey: 'alias', header: 'Alias' },
  {
    accessorKey: 'asset_category',
    header: 'Category',
    cell: ({ row }) =>
      row.original.asset_category ? (ASSET_CATEGORY_LABEL[row.original.asset_category] ?? row.original.asset_category) : '—',
  },
  {
    accessorKey: 'criticality',
    header: 'Criticality',
    cell: ({ row }) => (row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—'),
  },
  { accessorKey: 'status', header: 'Status (at snapshot time)' },
];

// Sin claim de shape estricta sobre lo que trae la DB — `assets_dump` es un campo `json` libre
// (ver collections/InventorySnapshots/index.ts), no hay generate:types que lo tipe.
function dumpArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const backHref = `/portal/inventory/snapshots${asOrganization ? `?asOrganization=${asOrganization}` : ''}`;
  const { data: snapshot, isPending } = useSnapshot(id);

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    );
  }

  if (!snapshot) {
    return (
      <Center py="xl">
        <Text c="dimmed">Could not load this snapshot.</Text>
      </Center>
    );
  }

  const dump = snapshot.assets_dump as { network?: unknown; non_network?: unknown } | null;
  const networkAssets = dumpArray<DumpedAsset>(dump?.network);
  const nonNetworkAssets = dumpArray<DumpedNonNetworkAsset>(dump?.non_network);

  return (
    <Stack gap="lg">
      <BackButton href={backHref} label="Back to Snapshot History" />

      <PageHeader
        title={`Snapshot — ${formatDateTime(snapshot.taken_at)}`}
        description="Immutable snapshot — each asset's status reflects that point in time, not its current state."
      />

      <Card withBorder padding="lg">
        <Group align="flex-start" wrap="wrap">
          <RingProgress
            size={120}
            thickness={12}
            sections={[{ value: snapshot.risk_score.global, color: 'pine' }]}
            label={
              <Text ta="center" fw={700}>
                {snapshot.risk_score.global}
              </Text>
            }
          />
          <Text c="dimmed">
            Global risk score at the time of this snapshot (based on Network assets only).
          </Text>
        </Group>
      </Card>

      <Tabs defaultValue="network">
        <Tabs.List>
          <Tabs.Tab value="network">Network ({networkAssets.length})</Tabs.Tab>
          <Tabs.Tab value="non-network">Other Assets ({nonNetworkAssets.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="network" pt="md">
          <DataTable
            columns={networkColumns}
            data={networkAssets}
            emptyLabel="No network assets in this snapshot"
            minWidth={720}
          />
        </Tabs.Panel>

        <Tabs.Panel value="non-network" pt="md">
          <DataTable
            columns={nonNetworkColumns}
            data={nonNetworkAssets}
            emptyLabel="No manually tracked assets in this snapshot"
            minWidth={680}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
