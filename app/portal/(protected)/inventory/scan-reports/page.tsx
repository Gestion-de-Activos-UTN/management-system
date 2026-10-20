'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Stack } from '@mantine/core'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { useScanReportsList } from '@/modules/scan-reports/hooks/use-scan-reports'
import { getScanReportsColumns } from '@/modules/scan-reports/scan-reports.columns'
import { SCAN_REPORT_STATUS_LABEL } from '@/modules/scan-reports/scan-report-labels'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

const STATUS_OPTIONS = Object.entries(SCAN_REPORT_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}))

export default function ScanReportsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useScanReportsList(asOrganization)
  const [status, setStatus] = useState<string[]>([])
  const canRename = Boolean(useTenantContext(asOrganization).data?.permissions.renameEvidence)
  const columns = useMemo(
    () => getScanReportsColumns(asOrganization, canRename),
    [asOrganization, canRename]
  )
  const filteredReports = useMemo(
    () =>
      (data ?? []).filter(report => !status.length || status.includes(report.status ?? 'received')),
    [data, status]
  )

  return (
    <Stack gap="md">
      <PageHeader
        title="Informes de escaneo"
        description="Todos los informes enviados por un agente, con la cantidad de activos aceptados o rechazados."
      />
      <FilterBar>
        <MultiFilterSelect
          ariaLabel="Estado"
          allLabel="Todos los estados"
          data={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
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
