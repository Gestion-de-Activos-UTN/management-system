'use client';

import { useSearchParams } from 'next/navigation';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAssetsList } from '@/modules/assets/hooks/use-assets';
import { assetsColumns } from '@/modules/assets/assets.columns';

export default function InventoryPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data, isPending } = useAssetsList(asOrganization);

  return (
    <Stack gap="md">
      <PageHeader title="Inventory" description="Assets discovered across your offices." />
      <DataTable columns={assetsColumns} data={data ?? []} isLoading={isPending} emptyLabel="No assets" />
    </Stack>
  );
}
