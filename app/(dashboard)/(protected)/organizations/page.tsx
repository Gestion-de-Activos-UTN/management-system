'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Alert, Button, Stack, TextInput } from '@mantine/core'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { PageHeader } from '@/components/ui/PageHeader'
import type { Organization } from '@/app/types/payload-types'
import {
  useCreateOrganization,
  useOrganizationOperationalSummary,
  useOrganizationsList,
} from '@/modules/organizations/hooks/use-organizations'
import {
  getOrganizationsColumns,
  type OrganizationListRow,
} from '@/modules/organizations/organizations.columns'
import { OrganizationStatusModal } from '@/modules/organizations/components/OrganizationStatusModal'
import { OrganizationCreateModal } from '@/modules/organizations/components/OrganizationCreateModal'
import { MemberCreateModal } from '@/modules/users/components/MemberCreateModal'
import { useCreatePlatformOrgAdmin } from '@/modules/users/hooks/use-org-members'

const ORGANIZATION_STATUS_OPTIONS = [
  { value: 'active', label: 'Activas' },
  { value: 'inactive', label: 'Inactivas' },
]

export default function OrganizationsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useOrganizationsList(asOrganization)
  const operationalSummary = useOrganizationOperationalSummary()
  const createOrganization = useCreateOrganization()
  const [statusTarget, setStatusTarget] = useState<Organization | null>(null)
  const [adminTarget, setAdminTarget] = useState<Organization | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string[]>([])
  const columns = useMemo(() => getOrganizationsColumns(setStatusTarget, setAdminTarget), [])
  const createAdmin = useCreatePlatformOrgAdmin(String(adminTarget?.id ?? ''))
  const organizationRows = useMemo<OrganizationListRow[]>(
    () =>
      (data ?? []).map(organization => ({
        ...organization,
        active_office_count:
          operationalSummary.data?.counts.offices[String(organization.id)] ??
          (operationalSummary.isError ? null : 0),
        active_agent_count:
          operationalSummary.data?.counts.agents[String(organization.id)]?.active ??
          (operationalSummary.isError ? null : 0),
        online_agent_count:
          operationalSummary.data?.counts.agents[String(organization.id)]?.online ??
          (operationalSummary.isError ? null : 0),
      })),
    [data, operationalSummary.data, operationalSummary.isError]
  )
  const visibleOrganizations = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es')
    return organizationRows.filter(organization => {
      const matchesName = organization.name.toLocaleLowerCase('es').includes(normalizedSearch)
      const organizationStatus = organization.is_active === false ? 'inactive' : 'active'
      const matchesStatus = status.length === 0 || status.includes(organizationStatus)
      return matchesName && matchesStatus
    })
  }, [organizationRows, search, status])

  return (
    <Stack gap="md">
      <PageHeader
        title="Organizaciones"
        description="Administración de organizaciones desde PlatformPortal."
        rightSection={<Button onClick={() => setCreating(true)}>Crear organización</Button>}
      />
      <FilterBar cols={{ base: 1, sm: 2, lg: 2 }}>
        <TextInput
          placeholder="Buscar por nombre..."
          aria-label="Buscar organizaciones"
          leftSection={<Search size={16} strokeWidth={1.5} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
          w="100%"
        />
        <MultiFilterSelect
          ariaLabel="Estado"
          allLabel="Todos los estados"
          data={ORGANIZATION_STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
        />
      </FilterBar>
      {operationalSummary.isError && (
        <Alert color="red" title="No se pudo cargar el resumen operativo">
          Los nombres y estados siguen disponibles; vuelve a cargar para consultar las oficinas y
          los escáneres.
        </Alert>
      )}
      <DataTable
        columns={columns}
        data={visibleOrganizations}
        isLoading={isPending || operationalSummary.isPending}
        emptyLabel={
          data?.length
            ? 'Ninguna organización coincide con la búsqueda o los filtros'
            : 'No hay organizaciones'
        }
        minWidth={850}
      />
      <OrganizationStatusModal organization={statusTarget} onClose={() => setStatusTarget(null)} />
      <OrganizationCreateModal
        opened={creating}
        onClose={() => setCreating(false)}
        onSubmit={input => createOrganization.mutateAsync(input)}
        isPending={createOrganization.isPending}
      />
      <MemberCreateModal
        opened={Boolean(adminTarget)}
        onClose={() => setAdminTarget(null)}
        officeOptions={[]}
        roles={['org_admin']}
        lockedRole="org_admin"
        onSubmit={input =>
          createAdmin.mutateAsync({
            name: input.name,
            email: input.email,
            password: input.password,
          })
        }
        isPending={createAdmin.isPending}
      />
    </Stack>
  )
}
