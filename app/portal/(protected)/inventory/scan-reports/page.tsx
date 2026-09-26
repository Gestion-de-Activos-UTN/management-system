'use client'

import { useSearchParams } from 'next/navigation'
import { Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useScanReportsList } from '@/modules/scan-reports/hooks/use-scan-reports'
import { scanReportsColumns } from '@/modules/scan-reports/scan-reports.columns'

export default function ScanReportsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useScanReportsList(asOrganization)

  return (
    <Stack gap="md">
      <PageHeader
        title="Informes de escaneo"
        description="Todos los informes enviados por un agente, con la cantidad de activos aceptados o rechazados."
      />
      <DataTable
        columns={scanReportsColumns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="Aún no hay informes de escaneo"
        minWidth={760}
      />
    </Stack>
  )
}
