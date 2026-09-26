'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Group, Select, SimpleGrid, Stack, Tooltip } from '@mantine/core'
import { Camera } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { useSnapshotsList } from '@/modules/inventory-snapshots/hooks/use-snapshots'
import { useGenerateSnapshot } from '@/modules/inventory-snapshots/hooks/use-generate-snapshot'
import { inventorySnapshotsColumns } from '@/modules/inventory-snapshots/inventory-snapshots.columns'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { canDo } from '@/access/rbac/permissions'

const ALL = ''

const GENERATED_BY_OPTIONS = [
  { value: ALL, label: 'Todos los orígenes' },
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

  const [generatedBy, setGeneratedBy] = useState<string>(ALL)

  const filteredSnapshots = useMemo(
    () => (data ?? []).filter(s => generatedBy === ALL || s.generated_by === generatedBy),
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
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
        <Select
          placeholder="Origen"
          data={GENERATED_BY_OPTIONS}
          value={generatedBy}
          onChange={v => setGeneratedBy(v ?? ALL)}
          w="100%"
        />
      </SimpleGrid>
      <DataTable
        columns={inventorySnapshotsColumns}
        data={filteredSnapshots}
        isLoading={isPending}
        emptyLabel="Ninguna instantánea coincide con este filtro"
        minWidth={760}
      />
    </Stack>
  )
}
