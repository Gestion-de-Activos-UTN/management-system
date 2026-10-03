'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Select, Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { useScanReportsList } from '@/modules/scan-reports/hooks/use-scan-reports'
import { getScanReportsColumns } from '@/modules/scan-reports/scan-reports.columns'
import { SCAN_REPORT_STATUS_LABEL } from '@/modules/scan-reports/scan-report-labels'

const ALL = ''

const STATUS_OPTIONS = [
  { value: ALL, label: 'Todos los estados' },
  ...Object.entries(SCAN_REPORT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export default function ScanReportsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useScanReportsList(asOrganization)
  const [status, setStatus] = useState<string>(ALL)
  const columns = useMemo(() => getScanReportsColumns(asOrganization), [asOrganization])
  const filteredReports = useMemo(
    () => (data ?? []).filter(report => status === ALL || (report.status ?? 'received') === status),
    [data, status]
  )

  return (
    <Stack gap="md">
      <PageHeader
        title="Informes de escaneo"
        description="Todos los informes enviados por un agente, con la cantidad de activos aceptados o rechazados."
      />
      <FilterBar>
        <Select
          placeholder="Estado"
          data={STATUS_OPTIONS}
          value={status}
          onChange={v => setStatus(v ?? ALL)}
          w="100%"
        />
      </FilterBar>
      <DataTable
        columns={columns}
        data={filteredReports}
        isLoading={isPending}
        emptyLabel="Ningún informe coincide con este filtro"
        minWidth={760}
      />
    </Stack>
  )
}
