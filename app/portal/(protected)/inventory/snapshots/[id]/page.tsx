'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Card, Center, Group, Loader, RingProgress, Stack, Tabs, Text } from '@mantine/core'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { BackButton } from '@/components/ui/BackButton'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { useSnapshot } from '@/modules/inventory-snapshots/hooks/use-snapshot'
import { formatDateTime } from '@/lib/format-date'
import { ASSET_CATEGORY_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels'

type DumpedAsset = {
  id?: string
  ip?: string
  hostname?: string
  alias?: string
  criticality?: string
  status?: string
}

type DumpedNonNetworkAsset = {
  id?: string
  alias?: string
  asset_category?: string
  criticality?: string
  status?: string
}

const networkColumns: ColumnDef<DumpedAsset, unknown>[] = [
  { accessorKey: 'alias', header: 'Alias' },
  {
    accessorKey: 'ip',
    header: 'IP',
    cell: ({ row }) => <TechnicalText>{row.original.ip ?? '—'}</TechnicalText>,
  },
  { accessorKey: 'hostname', header: 'Nombre del host' },
  {
    accessorKey: 'criticality',
    header: 'Criticidad',
    cell: ({ row }) =>
      row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—',
  },
  { accessorKey: 'status', header: 'Estado (al momento de la instantánea)' },
]

const nonNetworkColumns: ColumnDef<DumpedNonNetworkAsset, unknown>[] = [
  { accessorKey: 'alias', header: 'Alias' },
  {
    accessorKey: 'asset_category',
    header: 'Categoría',
    cell: ({ row }) =>
      row.original.asset_category
        ? (ASSET_CATEGORY_LABEL[row.original.asset_category] ?? row.original.asset_category)
        : '—',
  },
  {
    accessorKey: 'criticality',
    header: 'Criticidad',
    cell: ({ row }) =>
      row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—',
  },
  { accessorKey: 'status', header: 'Estado (al momento de la instantánea)' },
]

// Sin claim de shape estricta sobre lo que trae la DB — `assets_dump` es un campo `json` libre
// (ver collections/InventorySnapshots/index.ts), no hay generate:types que lo tipe.
function dumpArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const backHref = `/portal/inventory/snapshots${asOrganization ? `?asOrganization=${asOrganization}` : ''}`
  const { data: snapshot, isPending } = useSnapshot(id)

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  }

  if (!snapshot) {
    return (
      <Center py="xl">
        <Text c="dimmed">No se pudo cargar esta instantánea.</Text>
      </Center>
    )
  }

  const dump = snapshot.assets_dump as { network?: unknown; non_network?: unknown } | null
  const networkAssets = dumpArray<DumpedAsset>(dump?.network)
  const nonNetworkAssets = dumpArray<DumpedNonNetworkAsset>(dump?.non_network)
  const risk = snapshot.assessment_results_snapshot as {
    score?: number | null
    coverage?: number
    excluded_assets?: number
  }

  return (
    <Stack gap="lg">
      <BackButton href={backHref} label="Volver al Historial de instantáneas" />

      <PageHeader
        title={`Instantánea — ${formatDateTime(snapshot.taken_at)}`}
        description="Instantánea inmutable: el estado de cada activo refleja ese momento, no su estado actual."
      />

      <Card withBorder padding="lg">
        <Group align="flex-start" wrap="wrap">
          <RingProgress
            size={120}
            thickness={12}
            sections={[{ value: risk.score ?? 0, color: 'red' }]}
            label={
              <Text ta="center" fw={700}>
                {risk.score == null ? '—' : Math.round(risk.score)}
              </Text>
            }
          />
          <Text c="dimmed">
            {risk.score == null
              ? 'El riesgo no era evaluable al momento de esta instantánea.'
              : `Riesgo en ese momento. La cobertura de la evaluación era del ${Math.round(risk.coverage ?? 0)} %.`}
          </Text>
          {(risk.excluded_assets ?? 0) > 0 && (
            <Text size="sm" c="dimmed">
              {risk.excluded_assets} activos estaban fuera del alcance de la evaluación de seguridad
              en ese momento.
            </Text>
          )}
        </Group>
      </Card>

      <Tabs defaultValue="network">
        <Tabs.List>
          <Tabs.Tab value="network">Red ({networkAssets.length})</Tabs.Tab>
          <Tabs.Tab value="non-network">Activos manuales ({nonNetworkAssets.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="network" pt="md">
          <DataTable
            columns={networkColumns}
            data={networkAssets}
            emptyLabel="No hay activos de red en esta instantánea"
            minWidth={720}
          />
        </Tabs.Panel>

        <Tabs.Panel value="non-network" pt="md">
          <DataTable
            columns={nonNetworkColumns}
            data={nonNetworkAssets}
            emptyLabel="No hay activos manuales en esta instantánea"
            minWidth={680}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
