'use client';

import { useSearchParams } from 'next/navigation';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOfficesList } from '@/modules/offices/hooks/use-offices';
import { officesColumns } from '@/modules/offices/offices.columns';

export default function AdminOfficesPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data, isPending } = useOfficesList(asOrganization);

  return (
    <Stack gap="md">
      <PageHeader title="Offices" description="Offices in your organization." />
      <DataTable columns={officesColumns} data={data ?? []} isLoading={isPending} emptyLabel="No offices" />
    </Stack>
  );
}
