'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useOfficeAgentSummary, useOfficesList } from '@/modules/offices/hooks/use-offices'
import { getOfficesColumns } from '@/modules/offices/offices.columns'
import type { Office } from '@/app/types/payload-types'
import { AgentProvisionModal } from '@/modules/offices/components/AgentProvisionModal'

export default function AdminOfficesPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useOfficesList(asOrganization)
  const { data: agentSummaryResponse } = useOfficeAgentSummary(asOrganization)
  const agentSummary = agentSummaryResponse?.docs
  const [selectedOffice, setSelectedOffice] = useState<Office | null>(null)
  const columns = useMemo(() => getOfficesColumns(setSelectedOffice, agentSummary), [agentSummary])

  return (
    <Stack gap="md">
      <PageHeader title="Offices" description="Offices in your organization." />
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="No offices"
        minWidth={760}
      />
      <AgentProvisionModal
        office={selectedOffice}
        opened={selectedOffice !== null}
        onClose={() => setSelectedOffice(null)}
        summary={agentSummary?.find(summary => summary.office_id === String(selectedOffice?.id))}
        quota={agentSummaryResponse?.quota ?? null}
      />
    </Stack>
  )
}
