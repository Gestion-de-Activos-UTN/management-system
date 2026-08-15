'use client';

import { useSearchParams } from 'next/navigation';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useOrganizationsList } from '@/modules/organizations/hooks/use-organizations';
import { organizationsColumns } from '@/modules/organizations/organizations.columns';

export default function OrganizationsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data, isPending } = useOrganizationsList(asOrganization);

  return (
    <Stack gap="md">
      <PageHeader title="Organizations" description="Every tenant on the platform." />
      <DataTable
        columns={organizationsColumns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="No organizations"
      />
    </Stack>
  );
}
