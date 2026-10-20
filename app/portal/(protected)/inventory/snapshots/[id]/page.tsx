'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Center, Loader, Stack, Tabs, Text } from '@mantine/core'
import { Gauge, Package, Server, ShieldCheck } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { BackButton } from '@/components/ui/BackButton'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { useRenameSnapshot, useSnapshot } from '@/modules/inventory-snapshots/hooks/use-snapshot'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { EVIDENCE_NAME_MAX, evidenceNameError } from '@/modules/scan-reports/schema'
import { EditableTitle } from '@/components/ui/EditableTitle'
import { formatScanWindow } from '@/lib/format-date'
import { ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { portalHref } from '@/lib/portal-href'

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

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  offline: 'warning',
  retired: 'neutral',
}

// Mismas celdas compactas que el inventario vivo (assets/non-network-assets columns): nombre
// arriba, dato secundario debajo.
const statusColumn = {
  accessorKey: 'status',
  header: 'Estado en la instantánea',
  size: 180,
  meta: { align: 'center' },
  cell: ({ row }: { row: { original: { status?: string } } }) =>
    row.original.status ? (
      <StatusBadge
        tone={STATUS_TONE[row.original.status] ?? 'neutral'}
        label={ASSET_STATUS_LABEL[row.original.status] ?? row.original.status}
      />
    ) : (
      '—'
    ),
}

const criticalityColumn = {
  accessorKey: 'criticality',
  header: 'Criticidad',
  size: 120,
  cell: ({ row }: { row: { original: { criticality?: string } } }) =>
    row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—',
}

const networkColumns: ColumnDef<DumpedAsset, unknown>[] = [
  {
    id: 'device',
    header: 'Equipo',
    accessorFn: asset => asset.alias || asset.hostname || asset.ip || '',
    cell: ({ row }) => {
      const { alias, hostname, ip } = row.original
      const name = alias || hostname || ip
      const technical = [ip, hostname].filter(value => value && value !== name).join(' · ')
      return (
        <Stack gap={2}>
          <Text size="sm" fw={600} ff={name && name !== alias ? 'monospace' : undefined}>
            {name ?? '—'}
          </Text>
          {technical && (
            <TechnicalText size="xs" c="dimmed">
              {technical}
            </TechnicalText>
          )}
        </Stack>
      )
    },
  },
  criticalityColumn,
  statusColumn,
]

const nonNetworkColumns: ColumnDef<DumpedNonNetworkAsset, unknown>[] = [
  {
    accessorKey: 'alias',
    header: 'Activo',
    cell: ({ row }) => (
      <Stack gap={2}>
        <Text size="sm" fw={600}>
          {row.original.alias ?? '—'}
        </Text>
        {row.original.asset_category && (
          <Text size="xs" c="dimmed">
            {ASSET_CATEGORY_LABEL[row.original.asset_category] ?? row.original.asset_category}
          </Text>
        )}
      </Stack>
    ),
  },
  criticalityColumn,
  statusColumn,
]

// Sin claim de shape estricta sobre lo que trae la DB — `assets_dump` es un campo `json` libre
// (ver collections/InventorySnapshots/index.ts), no hay generate:types que lo tipe.
function dumpArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export default function SnapshotDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const backHref = portalHref('/portal/inventory/snapshots', asOrganization)
  const { data: snapshot, isPending } = useSnapshot(id)
  const rename = useRenameSnapshot(id)
  const tenant = useTenantContext(asOrganization)

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
        title={
          <EditableTitle
            value={snapshot.display_name ?? ''}
            fallback="Instantánea"
            canEdit={Boolean(tenant.data?.permissions.renameEvidence)}
            saving={rename.isPending}
            maxLength={EVIDENCE_NAME_MAX}
            validate={evidenceNameError}
            onSave={rename.mutateAsync}
          />
        }
        // La fecha va una sola vez, acá; el nombre propio (si hay) es sólo una etiqueta.
        description={`${formatScanWindow(snapshot.taken_at)} · El estado de cada activo refleja ese momento, no su estado actual.`}
        rightSection={
          <CreateRelatedTaskButton
            reference={{ relationTo: 'inventory-snapshots', value: String(snapshot.id) }}
            asOrganization={asOrganization}
          />
        }
      />

      <MetricsStrip
        isPending={false}
        metrics={[
          {
            key: 'score',
            icon: Gauge,
            value: risk.score == null ? 'No evaluable' : Math.round(risk.score),
            label: 'puntaje de riesgo en ese momento',
          },
          {
            key: 'coverage',
            icon: ShieldCheck,
            value: risk.score == null ? '—' : `${Math.round(risk.coverage ?? 0)} %`,
            label: 'cobertura de la evaluación',
          },
          { key: 'network', icon: Server, value: networkAssets.length, label: 'activos de red' },
          {
            key: 'manual',
            icon: Package,
            value: nonNetworkAssets.length,
            label: 'activos manuales',
          },
        ]}
      />
      {(risk.excluded_assets ?? 0) > 0 && (
        <Text size="sm" c="dimmed">
          {risk.excluded_assets} activos estaban fuera del alcance de la evaluación de seguridad en
          ese momento.
        </Text>
      )}

      <Tabs defaultValue="network">
        <Tabs.List>
          <Tabs.Tab value="network" leftSection={<Server size={16} strokeWidth={1.5} />}>
            Red ({networkAssets.length})
          </Tabs.Tab>
          <Tabs.Tab value="non-network" leftSection={<Package size={16} strokeWidth={1.5} />}>
            Activos manuales ({nonNetworkAssets.length})
          </Tabs.Tab>
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
