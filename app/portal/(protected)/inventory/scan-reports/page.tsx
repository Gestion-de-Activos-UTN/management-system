'use client';

import { useSearchParams } from 'next/navigation';
import { Stack } from '@mantine/core';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useScanReportsList } from '@/modules/scan-reports/hooks/use-scan-reports';
import { scanReportsColumns } from '@/modules/scan-reports/scan-reports.columns';

export default function ScanReportsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data, isPending } = useScanReportsList(asOrganization);

  return (
    <Stack gap="md">
      <PageHeader
        title="Scan Reports"
        description="Every report sent by an agent, with how many assets it accepted or rejected."
      />
      <DataTable
        columns={scanReportsColumns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="No scan reports yet"
      />
    </Stack>
  );
}
