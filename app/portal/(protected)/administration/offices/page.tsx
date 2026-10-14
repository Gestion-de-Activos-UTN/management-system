'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Button, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { Plus, Search } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { locationLabel } from '@/lib/argentina-geo'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { useOfficeAgentSummary, useOfficesList } from '@/modules/offices/hooks/use-offices'
import { getOfficesColumns } from '@/modules/offices/offices.columns'
import type { Office } from '@/app/types/payload-types'
import { AgentProvisionModal } from '@/modules/offices/components/AgentProvisionModal'
import { OfficeFormModal } from '@/modules/offices/components/OfficeFormModal'
import { OfficeStatusModal } from '@/modules/offices/components/OfficeStatusModal'

type StatusFilter = 'active' | 'inactive' | 'all'

export default function AdminOfficesPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data, isPending } = useOfficesList(asOrganization, { includeInactive: true })
  const { data: agentSummaryResponse } = useOfficeAgentSummary(asOrganization)
  const { data: tenantContext } = useTenantContext(asOrganization)
  const agentSummary = agentSummaryResponse?.docs
  const [scannerOffice, setScannerOffice] = useState<Office | null>(null)
  // undefined = modal cerrado; null = oficina nueva.
  const [editing, setEditing] = useState<Office | null | undefined>(undefined)
  const [statusOffice, setStatusOffice] = useState<Office | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const columns = useMemo(
    () =>
      getOfficesColumns(
        { onScanner: setScannerOffice, onEdit: setEditing, onToggleActive: setStatusOffice },
        agentSummary
      ),
    [agentSummary]
  )
  const offices = data ?? []
  const hasInactive = offices.some(office => office.is_active === false)
  const activeCount = offices.filter(office => office.is_active !== false).length
  const maxOffices = tenantContext?.limits?.max_offices ?? null
  const atLimit = maxOffices !== null && activeCount >= maxOffices
  const term = search.trim().toLocaleLowerCase('es')
  const visible = offices.filter(office => {
    const active = office.is_active !== false
    if (hasInactive && status !== 'all' && active !== (status === 'active')) return false
    if (!term) return true
    const haystack = `${office.name} ${locationLabel(office.province_id, office.department_id) ?? ''}`
    return haystack.toLocaleLowerCase('es').includes(term)
  })

  return (
    <Stack gap="md">
      <PageHeader
        title="Oficinas"
        description="Oficinas de tu organización."
        rightSection={
          <Group gap="md" wrap="wrap" justify="flex-end">
            {maxOffices !== null && !isPending && (
              <Text size="sm" c={atLimit ? 'orange' : 'dimmed'}>
                {activeCount} de {maxOffices} oficinas activas en tu plan
              </Text>
            )}
            <Tooltip
              label="Alcanzaste el máximo de oficinas activas de tu plan. Desactiva una para crear otra."
              disabled={!atLimit}
              multiline
              w={260}
            >
              <Button
                leftSection={<Plus size={16} strokeWidth={1.5} />}
                // data-disabled: un botón deshabilitado no dispara el Tooltip que explica por qué.
                data-disabled={atLimit || undefined}
                onClick={atLimit ? undefined : () => setEditing(null)}
              >
                Nueva oficina
              </Button>
            </Tooltip>
          </Group>
        }
      />
      <FilterBar>
        <TextInput
          placeholder="Buscar por nombre o ubicación"
          aria-label="Buscar oficinas"
          leftSection={<Search size={16} strokeWidth={1.5} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
          w="100%"
        />
        {/* Sólo cambia el resultado si hay oficinas inactivas. */}
        {hasInactive && (
          <Select
            placeholder="Estado"
            aria-label="Filtrar por estado"
            allowDeselect={false}
            data={[
              { value: 'all', label: 'Todas las oficinas' },
              { value: 'active', label: 'Oficinas activas' },
              { value: 'inactive', label: 'Oficinas inactivas' },
            ]}
            value={status}
            onChange={value => setStatus((value as StatusFilter) ?? 'all')}
            w="100%"
          />
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        data={visible}
        isLoading={isPending}
        emptyLabel={term ? 'Ninguna oficina coincide con la búsqueda' : 'No hay oficinas'}
        minWidth={760}
      />
      <AgentProvisionModal
        office={scannerOffice}
        opened={scannerOffice !== null}
        onClose={() => setScannerOffice(null)}
        summary={agentSummary?.find(summary => summary.office_id === String(scannerOffice?.id))}
        quota={agentSummaryResponse?.quota ?? null}
      />
      <OfficeFormModal
        office={editing ?? null}
        opened={editing !== undefined}
        onClose={() => setEditing(undefined)}
        asOrganization={asOrganization}
      />
      <OfficeStatusModal
        office={statusOffice}
        onClose={() => setStatusOffice(null)}
        asOrganization={asOrganization}
      />
    </Stack>
  )
}
