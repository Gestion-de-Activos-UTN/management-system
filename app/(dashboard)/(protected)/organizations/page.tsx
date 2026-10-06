'use client'

import { useSearchParams } from 'next/navigation'
import { Stack } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useOrganizationsList } from '@/modules/organizations/hooks/use-organizations'
import { organizationsColumns } from '@/modules/organizations/organizations.columns'

export default function OrganizationsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useOrganizationsList(asOrganization)

  return (
    <Stack gap="md">
      <PageHeader title="Organizaciones" description="Cada organización de la plataforma." />
      <DataTable
        columns={organizationsColumns}
        data={data ?? []}
        isLoading={isPending}
        emptyLabel="No hay organizaciones"
        minWidth={720}
      />
    </Stack>
  )
}
