'use client'

import { matchesSearch } from '@/lib/search-text'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useUiStore } from '@/lib/ui-store'
import {
  Button,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Tabs,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { History, Package, Plus, Search, Server } from 'lucide-react'
import { FilterBar } from '@/components/ui/FilterBar'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { MANUAL_ASSET_CATEGORY_GROUPS } from '@/domain/assets/asset-types'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { InventoryIncidentsPanel } from '@/modules/assets/components/InventoryIncidentsPanel'
import { useAssetsList } from '@/modules/assets/hooks/use-assets'
import { getAssetsColumns } from '@/modules/assets/assets.columns'
import { useNonNetworkAssetsList } from '@/modules/non-network-assets/hooks/use-non-network-assets'
import { getNonNetworkAssetsColumns } from '@/modules/non-network-assets/non-network-assets.columns'
import { NonNetworkAssetForm } from '@/modules/non-network-assets/components/NonNetworkAssetForm'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { ASSET_STATUS_OPTIONS, CRITICALITY_OPTIONS } from '@/lib/enum-labels'
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { portalHref } from '@/lib/portal-href'

const ALL = ''

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
  const [assetCriticality, setAssetCriticality] = useState<string[]>([])
  const [assetStatus, setAssetStatus] = useState<string[]>([])
  const [assetIdentified, setAssetIdentified] = useState<string>(ALL)

  const assetBucket = useFrozenBucket(assets, a => (a.status ?? 'active') === 'active')

  const filteredAssets = useMemo(() => {
    return (assets ?? []).filter((a: Asset) => {
      const isIdentified = a.identification_status === 'confirmed'
      return (
        matchesSearch([isIdentified ? a.alias : null, a.hostname, a.ip], assetSearch) &&
        (!assetCriticality.length ||
          (isIdentified && assetCriticality.includes(a.criticality ?? ''))) &&
        (!assetStatus.length || assetStatus.includes(a.status ?? 'active')) &&
        (assetIdentified === ALL || String(Boolean(a.identified)) === assetIdentified)
      )
    })
  }, [assets, assetSearch, assetCriticality, assetStatus, assetIdentified])

  const { active: activeAssets, inactive: inactiveAssets } = useMemo(
    () => partitionByFrozenBucket(filteredAssets, assetBucket),
    [filteredAssets, assetBucket]
  )

  const [nnaSearch, setNnaSearch] = useState('')
  const [nnaCategory, setNnaCategory] = useState<string[]>([])
  const [nnaCriticality, setNnaCriticality] = useState<string[]>([])
  const [nnaReviewStatus, setNnaReviewStatus] = useState<string>(ALL)

  const nnaBucket = useFrozenBucket(nonNetworkAssets, a => (a.status ?? 'active') === 'active')

  const filteredNonNetworkAssets = useMemo(() => {
    return (nonNetworkAssets ?? []).filter(
      (a: NonNetworkAsset) =>
        matchesSearch([a.alias], nnaSearch) &&
        (!nnaCategory.length || nnaCategory.includes(a.asset_category)) &&
        (!nnaCriticality.length || nnaCriticality.includes(a.criticality)) &&
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
          <Group gap="sm" wrap="wrap">
            <CreateRelatedTaskButton
              reference={{ relationTo: 'offices', value: selectedOfficeId }}
              asOrganization={asOrganization}
              editable
              label="Tarea de inventario"
            />
            <Button
              component={Link}
              href={portalHref('/portal/inventory/snapshots', asOrganization)}
              variant="light"
              leftSection={<History size={16} strokeWidth={1.5} />}
              w={{ base: '100%', sm: 'auto' }}
            >
              Historial de instantáneas
            </Button>
          </Group>
        }
      />

      <InventoryIncidentsPanel asOrganization={asOrganization} />

      {/* ?tab=non-network: los enlaces del panel general abren directo en activos manuales. */}
      <Tabs defaultValue={searchParams.get('tab') === 'non-network' ? 'non-network' : 'network'}>
        <Tabs.List>
          <Tabs.Tab value="network" leftSection={<Server size={16} strokeWidth={1.5} />}>
            Red
          </Tabs.Tab>
          <Tabs.Tab value="non-network" leftSection={<Package size={16} strokeWidth={1.5} />}>
            Activos manuales
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="network" pt="md">
          <Stack gap="sm">
            <FilterBar>
              <TextInput
                placeholder="Buscar alias, nombre de host o IP..."
                leftSection={<Search size={16} strokeWidth={1.5} />}
                value={assetSearch}
                onChange={e => setAssetSearch(e.currentTarget.value)}
                w="100%"
              />
              <MultiFilterSelect
                ariaLabel="Criticidad"
                allLabel="Todas las criticidades"
                data={CRITICALITY_OPTIONS}
                value={assetCriticality}
                onChange={setAssetCriticality}
              />
              <MultiFilterSelect
                ariaLabel="Estado"
                allLabel="Todos los estados"
                data={ASSET_STATUS_OPTIONS}
                value={assetStatus}
                onChange={setAssetStatus}
              />
              {/* Textos cortos: tres segmentos iguales en una columna de FilterBar. */}
              <Tooltip label="Identificación">
                <SegmentedControl
                  aria-label="Identificación"
                  fullWidth
                  data={[
                    { value: ALL, label: 'Todos' },
                    { value: 'true', label: 'Sí' },
                    { value: 'false', label: 'No' },
                  ]}
                  value={assetIdentified}
                  onChange={setAssetIdentified}
                />
              </Tooltip>
            </FilterBar>
            <DataTable
              columns={assetsColumns}
              data={activeAssets}
              isLoading={assetsPending}
              emptyLabel="Ningún activo coincide con estos filtros"
              minWidth={860}
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
                  minWidth={860}
                />
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="non-network" pt="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end" wrap="wrap">
              <FilterBar>
                <TextInput
                  placeholder="Buscar alias..."
                  leftSection={<Search size={16} strokeWidth={1.5} />}
                  value={nnaSearch}
                  onChange={e => setNnaSearch(e.currentTarget.value)}
                  w="100%"
                />
                <MultiFilterSelect
                  ariaLabel="Categoría"
                  allLabel="Todas las categorías"
                  data={MANUAL_ASSET_CATEGORY_GROUPS}
                  value={nnaCategory}
                  onChange={setNnaCategory}
                  searchable
                />
                <MultiFilterSelect
                  ariaLabel="Criticidad"
                  allLabel="Todas las criticidades"
                  data={CRITICALITY_OPTIONS}
                  value={nnaCriticality}
                  onChange={setNnaCriticality}
                />
                <Tooltip label="Estado de revisión">
                  <SegmentedControl
                    aria-label="Estado de revisión"
                    fullWidth
                    data={[
                      { value: ALL, label: 'Todas' },
                      { value: 'ok', label: 'Al día' },
                      { value: 'overdue', label: 'Vencidas' },
                    ]}
                    value={nnaReviewStatus}
                    onChange={setNnaReviewStatus}
                  />
                </Tooltip>
              </FilterBar>
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
