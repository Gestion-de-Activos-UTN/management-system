'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Stack, Tooltip } from '@mantine/core'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { Camera } from 'lucide-react'
import { FilterBar } from '@/components/ui/FilterBar'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { useSnapshotsList } from '@/modules/inventory-snapshots/hooks/use-snapshots'
import { useGenerateSnapshot } from '@/modules/inventory-snapshots/hooks/use-generate-snapshot'
import { getInventorySnapshotsColumns } from '@/modules/inventory-snapshots/inventory-snapshots.columns'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { canDo } from '@/access/rbac/permissions'

const GENERATED_BY_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'scheduled', label: 'Programada' },
  { value: 'pre_audit', label: 'Preauditoría' },
]

export default function InventorySnapshotsPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const selectedOfficeId = useUiStore(s => s.selectedOfficeId)
  const { data, isPending } = useSnapshotsList(asOrganization)
  const generateSnapshot = useGenerateSnapshot()
  const tenantContext = useTenantContext(asOrganization)
  const canGenerate = canDo(
    tenantContext.data?.role,
    'inventory-snapshots',
    'create',
    tenantContext.data?.organizationId ?? null
  )

  const [generatedBy, setGeneratedBy] = useState<string[]>([])
  const canRename = Boolean(tenantContext.data?.permissions.renameEvidence)
  const columns = useMemo(
    () => getInventorySnapshotsColumns(asOrganization, canRename),
    [asOrganization, canRename]
  )

  const filteredSnapshots = useMemo(
    () => (data ?? []).filter(s => !generatedBy.length || generatedBy.includes(s.generated_by)),
    [data, generatedBy]
  )

  return (
    <Stack gap="md">
      <PageHeader
        title="Historial de instantáneas"
        description="Instantáneas inmutables del inventario con el puntaje de riesgo de ese momento."
        rightSection={
          <Tooltip
            label={
              !canGenerate
                ? 'No tienes permiso para generar instantáneas'
                : 'Selecciona una oficina en la barra superior para generar una instantánea'
            }
            disabled={!!selectedOfficeId && canGenerate}
          >
            <Button
              leftSection={<Camera size={16} strokeWidth={1.5} />}
              disabled={!selectedOfficeId || !canGenerate}
              loading={generateSnapshot.isPending}
              onClick={() =>
                selectedOfficeId && canGenerate && generateSnapshot.mutate(selectedOfficeId)
              }
              w={{ base: '100%', sm: 'auto' }}
            >
              Generar instantánea
            </Button>
          </Tooltip>
        }
      />
      <FilterBar>
        <MultiFilterSelect
          ariaLabel="Origen"
          allLabel="Todos los orígenes"
          data={GENERATED_BY_OPTIONS}
          value={generatedBy}
          onChange={setGeneratedBy}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        data={filteredSnapshots}
        isLoading={isPending}
        emptyLabel="Ninguna instantánea coincide con este filtro"
        minWidth={760}
      />
    </Stack>
  )
}
