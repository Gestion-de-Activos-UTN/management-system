'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import type { Organization } from '@/app/types/payload-types'
import { useOrganizationsList } from '@/modules/organizations/hooks/use-organizations'
import { getOrganizationsColumns } from '@/modules/organizations/organizations.columns'
import { OrganizationStatusModal } from '@/modules/organizations/components/OrganizationStatusModal'

export default function OrganizationsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useOrganizationsList(asOrganization)
  const [statusTarget, setStatusTarget] = useState<Organization | null>(null)
  const columns = useMemo(() => getOrganizationsColumns(setStatusTarget), [])

  return (
    <Stack gap="md">
      <PageHeader title="Organizaciones" description="Cada organización de la plataforma." />
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="No hay organizaciones"
        minWidth={720}
      />
      <OrganizationStatusModal organization={statusTarget} onClose={() => setStatusTarget(null)} />
    </Stack>
  )
}
