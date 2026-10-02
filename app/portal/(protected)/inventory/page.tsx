'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useUiStore } from '@/lib/ui-store'
import {
  Button,
  Divider,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  TextInput,
} from '@mantine/core'
import { History, Plus, Search } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAssetsList } from '@/modules/assets/hooks/use-assets'
import { getAssetsColumns } from '@/modules/assets/assets.columns'
import { useNonNetworkAssetsList } from '@/modules/non-network-assets/hooks/use-non-network-assets'
import { getNonNetworkAssetsColumns } from '@/modules/non-network-assets/non-network-assets.columns'
import { NonNetworkAssetForm } from '@/modules/non-network-assets/components/NonNetworkAssetForm'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import {
  ASSET_CATEGORY_OPTIONS,
  ASSET_STATUS_OPTIONS,
  CRITICALITY_OPTIONS,
} from '@/lib/enum-labels'
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types'

const ALL = ''

function matchesSearch(haystacks: Array<string | null | undefined>, query: string): boolean {
  if (!query.trim()) return true
  const needle = query.trim().toLowerCase()
  return haystacks.some(h => h?.toLowerCase().includes(needle))
}

// Congela en qué "bucket" (activo / inactivo) cae cada fila la primera vez que la vemos, y la
// mantiene ahí aunque su status real cambie por una edición (que sí invalida y refetchea la
// query al toque). Solo se reasigna con un remount real del componente (recargar la página) —
// evita que una fila desaparezca de la vista de golpe apenas alguien la retira/pone offline.
function useFrozenBucket<T extends { id: string }>(
  items: T[] | undefined,
  isActive: (item: T) => boolean
): Map<string, boolean> {
  const frozen = useRef(new Map<string, boolean>())
  if (items) {
    for (const item of items) {
      const id = String(item.id)
      if (!frozen.current.has(id)) {
        frozen.current.set(id, isActive(item))
      }
    }
  }
  return frozen.current
}

function partitionByFrozenBucket<T extends { id: string }>(
  items: T[],
  bucket: Map<string, boolean>
): { active: T[]; inactive: T[] } {
  const active: T[] = []
  const inactive: T[] = []
  for (const item of items) {
    ;((bucket.get(String(item.id)) ?? true) ? active : inactive).push(item)
  }
  return { active, inactive }
}

export default function InventoryPage() {
  const searchParams = useSearchParams()
  const asOrganization = searchParams.get('asOrganization') ?? undefined
  const linkedOfficeId = searchParams.get('officeId')
  const linkedNonNetworkAssetId = searchParams.get('nonNetworkAsset')
  const { data: assets, isPending: assetsPending } = useAssetsList(asOrganization)
  const { data: nonNetworkAssets, isPending: nonNetworkAssetsPending } =
    useNonNetworkAssetsList(asOrganization)
  const { data: members } = useOrgMembers(asOrganization)
  const selectedOfficeId = useUiStore(state => state.selectedOfficeId)
  const setSelectedOfficeId = useUiStore(state => state.setSelectedOfficeId)

  const ownerNameById = useMemo(
    () => Object.fromEntries((members ?? []).map(m => [m.id, m.name])),
    [members]
  )

  // undefined = modal closed, null = modal open in "create" mode, object = "edit" mode.
  const [editingAsset, setEditingAsset] = useState<NonNetworkAsset | null | undefined>(undefined)

  useEffect(() => {
    if (linkedOfficeId) setSelectedOfficeId(linkedOfficeId)
  }, [linkedOfficeId, setSelectedOfficeId])

  useEffect(() => {
    if (!linkedNonNetworkAssetId || !nonNetworkAssets) return
    const linked = nonNetworkAssets.find(asset => String(asset.id) === linkedNonNetworkAssetId)
    if (linked) setEditingAsset(linked)
  }, [linkedNonNetworkAssetId, nonNetworkAssets])

  const [assetSearch, setAssetSearch] = useState('')
  const [assetCriticality, setAssetCriticality] = useState<string>(ALL)
  const [assetStatus, setAssetStatus] = useState<string>(ALL)
  const [assetIdentified, setAssetIdentified] = useState<string>(ALL)

  const assetBucket = useFrozenBucket(assets, a => (a.status ?? 'active') === 'active')

  const filteredAssets = useMemo(() => {
    return (assets ?? []).filter((a: Asset) => {
      const isIdentified = a.identification_status === 'confirmed'
      return (
        matchesSearch([isIdentified ? a.alias : null, a.hostname, a.ip], assetSearch) &&
        (assetCriticality === ALL || (isIdentified && a.criticality === assetCriticality)) &&
        (assetStatus === ALL || (a.status ?? 'active') === assetStatus) &&
        (assetIdentified === ALL || String(Boolean(a.identified)) === assetIdentified)
      )
    })
  }, [assets, assetSearch, assetCriticality, assetStatus, assetIdentified])

  const { active: activeAssets, inactive: inactiveAssets } = useMemo(
    () => partitionByFrozenBucket(filteredAssets, assetBucket),
    [filteredAssets, assetBucket]
  )

  const [nnaSearch, setNnaSearch] = useState('')
  const [nnaCategory, setNnaCategory] = useState<string>(ALL)
  const [nnaCriticality, setNnaCriticality] = useState<string>(ALL)
  const [nnaReviewStatus, setNnaReviewStatus] = useState<string>(ALL)

  const nnaBucket = useFrozenBucket(nonNetworkAssets, a => (a.status ?? 'active') === 'active')

  const filteredNonNetworkAssets = useMemo(() => {
    return (nonNetworkAssets ?? []).filter(
      (a: NonNetworkAsset) =>
        matchesSearch([a.alias], nnaSearch) &&
        (nnaCategory === ALL || a.asset_category === nnaCategory) &&
        (nnaCriticality === ALL || a.criticality === nnaCriticality) &&
        (nnaReviewStatus === ALL || a.review_status === nnaReviewStatus)
    )
  }, [nonNetworkAssets, nnaSearch, nnaCategory, nnaCriticality, nnaReviewStatus])

  const { active: activeNonNetworkAssets, inactive: inactiveNonNetworkAssets } = useMemo(
    () => partitionByFrozenBucket(filteredNonNetworkAssets, nnaBucket),
    [filteredNonNetworkAssets, nnaBucket]
  )

  const assetsColumns = useMemo(
    () => getAssetsColumns(ownerNameById, selectedOfficeId === null),
    [ownerNameById, selectedOfficeId]
  )
  const nonNetworkAssetsColumns = useMemo(
    () =>
      getNonNetworkAssetsColumns(asset => setEditingAsset(asset), ownerNameById, asOrganization),
    [ownerNameById, asOrganization]
  )

  return (
    <Stack gap="md">
      <PageHeader
        title="Inventario"
        description="Activos detectados en tus oficinas y activos registrados manualmente."
        rightSection={
          <Button
            component={Link}
            href={`/portal/inventory/snapshots${asOrganization ? `?asOrganization=${asOrganization}` : ''}`}
            variant="light"
            leftSection={<History size={16} strokeWidth={1.5} />}
            w={{ base: '100%', sm: 'auto' }}
          >
            Historial de instantáneas
          </Button>
        }
      />

      <Tabs defaultValue="network">
        <Tabs.List>
          <Tabs.Tab value="network">Red</Tabs.Tab>
          <Tabs.Tab value="non-network">Activos manuales</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="network" pt="md">
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
              <TextInput
                placeholder="Buscar alias, nombre de host o IP..."
                leftSection={<Search size={16} strokeWidth={1.5} />}
                value={assetSearch}
                onChange={e => setAssetSearch(e.currentTarget.value)}
                w="100%"
              />
              <Select
                placeholder="Criticidad"
                data={[{ value: ALL, label: 'Todas las criticidades' }, ...CRITICALITY_OPTIONS]}
                value={assetCriticality}
                onChange={v => setAssetCriticality(v ?? ALL)}
                w="100%"
              />
              <Select
                placeholder="Estado"
                data={[{ value: ALL, label: 'Todos los estados' }, ...ASSET_STATUS_OPTIONS]}
                value={assetStatus}
                onChange={v => setAssetStatus(v ?? ALL)}
                w="100%"
              />
              <Select
                placeholder="Identified"
                data={[
                  { value: ALL, label: 'Todos los estados de identificación' },
                  { value: 'true', label: 'Identified' },
                  { value: 'false', label: 'No identificado' },
                ]}
                value={assetIdentified}
                onChange={v => setAssetIdentified(v ?? ALL)}
                w="100%"
              />
            </SimpleGrid>
            <DataTable
              columns={assetsColumns}
              data={activeAssets}
              isLoading={assetsPending}
              emptyLabel="Ningún activo coincide con estos filtros"
              minWidth={980}
            />
            {inactiveAssets.length > 0 && (
              <>
                {/* Fila congelada al momento en que se detectó (ver useFrozenBucket) — un asset
                    retirado/offline no salta acá solo, hace falta recargar la página. */}
                <Divider label="Retirados y sin conexión" labelPosition="left" mt="md" />
                <DataTable
                  columns={assetsColumns}
                  data={inactiveAssets}
                  emptyLabel="No hay activos retirados ni sin conexión"
                  minWidth={980}
                />
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="non-network" pt="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end" wrap="wrap">
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" style={{ flex: 1 }}>
                <TextInput
                  placeholder="Buscar alias..."
                  leftSection={<Search size={16} strokeWidth={1.5} />}
                  value={nnaSearch}
                  onChange={e => setNnaSearch(e.currentTarget.value)}
                  w="100%"
                />
                <Select
                  placeholder="Categoría"
                  searchable
                  nothingFoundMessage="No se encontró ninguna categoría"
                  data={[{ value: ALL, label: 'Todas las categorías' }, ...ASSET_CATEGORY_OPTIONS]}
                  value={nnaCategory}
                  onChange={v => setNnaCategory(v ?? ALL)}
                  w="100%"
                />
                <Select
                  placeholder="Criticidad"
                  data={[{ value: ALL, label: 'Todas las criticidades' }, ...CRITICALITY_OPTIONS]}
                  value={nnaCriticality}
                  onChange={v => setNnaCriticality(v ?? ALL)}
                  w="100%"
                />
                <Select
                  placeholder="Revisión"
                  data={[
                    { value: ALL, label: 'Todos los estados de revisión' },
                    { value: 'ok', label: 'Al día' },
                    { value: 'overdue', label: 'Revisión vencida' },
                  ]}
                  value={nnaReviewStatus}
                  onChange={v => setNnaReviewStatus(v ?? ALL)}
                  w="100%"
                />
              </SimpleGrid>
              <Button
                leftSection={<Plus size={16} strokeWidth={1.5} />}
                onClick={() => setEditingAsset(null)}
                w={{ base: '100%', sm: 'auto' }}
              >
                Nuevo activo
              </Button>
            </Group>
            <DataTable
              columns={nonNetworkAssetsColumns}
              data={activeNonNetworkAssets}
              isLoading={nonNetworkAssetsPending}
              emptyLabel="Ningún activo manual coincide con estos filtros"
              minWidth={880}
            />
            {inactiveNonNetworkAssets.length > 0 && (
              <>
                <Divider label="Retirado" labelPosition="left" mt="md" />
                <DataTable
                  columns={nonNetworkAssetsColumns}
                  data={inactiveNonNetworkAssets}
                  emptyLabel="No hay activos retirados"
                  minWidth={880}
                />
              </>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={editingAsset !== undefined}
        onClose={() => setEditingAsset(undefined)}
        title={editingAsset ? 'Editar activo' : 'Nuevo activo'}
        size="lg"
        centered
      >
        <NonNetworkAssetForm
          asset={editingAsset ?? undefined}
          asOrganization={asOrganization}
          onSaved={() => setEditingAsset(undefined)}
        />
      </Modal>
    </Stack>
  )
}
