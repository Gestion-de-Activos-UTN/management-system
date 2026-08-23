'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Group, Select, Stack, Tooltip } from '@mantine/core';
import { Camera } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useUiStore } from '@/lib/ui-store';
import { useSnapshotsList } from '@/modules/inventory-snapshots/hooks/use-snapshots';
import { useGenerateSnapshot } from '@/modules/inventory-snapshots/hooks/use-generate-snapshot';
import { inventorySnapshotsColumns } from '@/modules/inventory-snapshots/inventory-snapshots.columns';
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context';
import { canDo } from '@/access/rbac/permissions';

const ALL = '';

const GENERATED_BY_OPTIONS = [
  { value: ALL, label: 'All sources' },
  { value: 'manual', label: 'Manual' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'pre_audit', label: 'Pre-audit' },
];

export default function InventorySnapshotsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  const { data, isPending } = useSnapshotsList(asOrganization);
  const generateSnapshot = useGenerateSnapshot();
  const tenantContext = useTenantContext(asOrganization);
  const canGenerate = canDo(
    tenantContext.data?.role,
    'inventory-snapshots',
    'create',
    tenantContext.data?.organizationId ?? null,
  );

  const [generatedBy, setGeneratedBy] = useState<string>(ALL);

  const filteredSnapshots = useMemo(
    () => (data ?? []).filter((s) => generatedBy === ALL || s.generated_by === generatedBy),
    [data, generatedBy],
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <PageHeader
          title="Snapshot History"
          description="Immutable snapshots of the inventory, with the risk score at that point in time."
        />
        <Tooltip
          label={
            !canGenerate
              ? "You don't have permission to generate snapshots"
              : 'Select an office in the top bar to generate a snapshot'
          }
          disabled={!!selectedOfficeId && canGenerate}
        >
          <Button
            leftSection={<Camera size={16} strokeWidth={1.5} />}
            disabled={!selectedOfficeId || !canGenerate}
            loading={generateSnapshot.isPending}
            onClick={() => selectedOfficeId && canGenerate && generateSnapshot.mutate(selectedOfficeId)}
          >
            Generate snapshot
          </Button>
        </Tooltip>
      </Group>
      <Group gap="sm">
        <Select
          placeholder="Source"
          data={GENERATED_BY_OPTIONS}
          value={generatedBy}
          onChange={(v) => setGeneratedBy(v ?? ALL)}
          w={180}
        />
      </Group>
      <DataTable
        columns={inventorySnapshotsColumns}
        data={filteredSnapshots}
        isLoading={isPending}
        emptyLabel="No snapshots match this filter"
      />
    </Stack>
  );
}
