'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Divider, Group, Modal, Select, SimpleGrid, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { History, Plus, RefreshCw, Search } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAssetsList } from '@/modules/assets/hooks/use-assets';
import { getAssetsColumns } from '@/modules/assets/assets.columns';
import { useNonNetworkAssetsList } from '@/modules/non-network-assets/hooks/use-non-network-assets';
import { getNonNetworkAssetsColumns } from '@/modules/non-network-assets/non-network-assets.columns';
import { NonNetworkAssetForm } from '@/modules/non-network-assets/components/NonNetworkAssetForm';
import { useOrgMembers } from '@/modules/users/hooks/use-org-members';
import { useNewScanResultBanner } from '@/modules/scan-reports/hooks/use-new-scan-result-banner';
import { ASSET_CATEGORY_OPTIONS, ASSET_STATUS_OPTIONS, CRITICALITY_OPTIONS } from '@/lib/enum-labels';
import type { Asset, NonNetworkAsset } from '@/app/types/payload-types';

const ALL = '';

function matchesSearch(haystacks: Array<string | null | undefined>, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return haystacks.some((h) => h?.toLowerCase().includes(needle));
}

// Congela en qué "bucket" (activo / inactivo) cae cada fila la primera vez que la vemos, y la
// mantiene ahí aunque su status real cambie por una edición (que sí invalida y refetchea la
// query al toque). Solo se reasigna con un remount real del componente (recargar la página) —
// evita que una fila desaparezca de la vista de golpe apenas alguien la retira/pone offline.
function useFrozenBucket<T extends { id: string }>(
  items: T[] | undefined,
  isActive: (item: T) => boolean,
): Map<string, boolean> {
  const frozen = useRef(new Map<string, boolean>());
  if (items) {
    for (const item of items) {
      const id = String(item.id);
      if (!frozen.current.has(id)) {
        frozen.current.set(id, isActive(item));
      }
    }
  }
  return frozen.current;
}

function partitionByFrozenBucket<T extends { id: string }>(
  items: T[],
  bucket: Map<string, boolean>,
): { active: T[]; inactive: T[] } {
  const active: T[] = [];
  const inactive: T[] = [];
  for (const item of items) {
    (bucket.get(String(item.id)) ?? true ? active : inactive).push(item);
  }
  return { active, inactive };
}

export default function InventoryPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data: assets, isPending: assetsPending } = useAssetsList(asOrganization);
  const { data: nonNetworkAssets, isPending: nonNetworkAssetsPending } = useNonNetworkAssetsList(asOrganization);
  const { data: members } = useOrgMembers(asOrganization);
  const { hasNewResult, acknowledge } = useNewScanResultBanner(asOrganization);
  const queryClient = useQueryClient();

  const ownerNameById = useMemo(
    () => Object.fromEntries((members ?? []).map((m) => [m.id, m.name])),
    [members],
  );

  // undefined = modal closed, null = modal open in "create" mode, object = "edit" mode.
  const [editingAsset, setEditingAsset] = useState<NonNetworkAsset | null | undefined>(undefined);

  const [assetSearch, setAssetSearch] = useState('');
  const [assetCriticality, setAssetCriticality] = useState<string>(ALL);
  const [assetStatus, setAssetStatus] = useState<string>(ALL);
  const [assetIdentified, setAssetIdentified] = useState<string>(ALL);

  const assetBucket = useFrozenBucket(assets, (a) => (a.status ?? 'active') === 'active');

  const filteredAssets = useMemo(() => {
    return (assets ?? []).filter(
      (a: Asset) =>
        matchesSearch([a.alias, a.hostname, a.ip], assetSearch) &&
        (assetCriticality === ALL || a.criticality === assetCriticality) &&
        (assetStatus === ALL || (a.status ?? 'active') === assetStatus) &&
        (assetIdentified === ALL || String(Boolean(a.identified)) === assetIdentified),
    );
  }, [assets, assetSearch, assetCriticality, assetStatus, assetIdentified]);

  const { active: activeAssets, inactive: inactiveAssets } = useMemo(
    () => partitionByFrozenBucket(filteredAssets, assetBucket),
    [filteredAssets, assetBucket],
  );

  const [nnaSearch, setNnaSearch] = useState('');
  const [nnaCategory, setNnaCategory] = useState<string>(ALL);
  const [nnaCriticality, setNnaCriticality] = useState<string>(ALL);
  const [nnaReviewStatus, setNnaReviewStatus] = useState<string>(ALL);

  const nnaBucket = useFrozenBucket(nonNetworkAssets, (a) => (a.status ?? 'active') === 'active');

  const filteredNonNetworkAssets = useMemo(() => {
    return (nonNetworkAssets ?? []).filter(
      (a: NonNetworkAsset) =>
        matchesSearch([a.alias], nnaSearch) &&
        (nnaCategory === ALL || a.asset_category === nnaCategory) &&
        (nnaCriticality === ALL || a.criticality === nnaCriticality) &&
        (nnaReviewStatus === ALL || a.review_status === nnaReviewStatus),
    );
  }, [nonNetworkAssets, nnaSearch, nnaCategory, nnaCriticality, nnaReviewStatus]);

  const { active: activeNonNetworkAssets, inactive: inactiveNonNetworkAssets } = useMemo(
    () => partitionByFrozenBucket(filteredNonNetworkAssets, nnaBucket),
    [filteredNonNetworkAssets, nnaBucket],
  );

  const assetsColumns = useMemo(() => getAssetsColumns(ownerNameById), [ownerNameById]);
  const nonNetworkAssetsColumns = useMemo(
    () => getNonNetworkAssetsColumns((asset) => setEditingAsset(asset), ownerNameById),
    [ownerNameById],
  );

  return (
    <Stack gap="md">
      <PageHeader
        title="Inventory"
        description="Assets discovered across your offices, and manually tracked assets."
        rightSection={
          <Button
            component={Link}
            href={`/portal/inventory/snapshots${asOrganization ? `?asOrganization=${asOrganization}` : ''}`}
            variant="light"
            leftSection={<History size={16} strokeWidth={1.5} />}
            w={{ base: '100%', sm: 'auto' }}
          >
            Snapshot History
          </Button>
        }
      />

      {hasNewResult && (
        // No auto-refetch: el poll (useNewScanResultBanner) solo mira si hay un scan-report
        // "processed" más nuevo que el visto — nunca invalida ['assets']/['non-network-assets']
        // por su cuenta. Si el usuario está a mitad del form de "New asset" (Modal de abajo),
        // ese refetch solo pasa cuando clickea "Refresh", nunca por detrás sin avisar.
        <Alert color="pine" variant="light">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm">New scan result received — the list below may be out of date.</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<RefreshCw size={14} strokeWidth={1.5} />}
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['assets'] });
                queryClient.invalidateQueries({ queryKey: ['non-network-assets'] });
                acknowledge();
              }}
            >
              Refresh
            </Button>
          </Group>
        </Alert>
      )}

      <Tabs defaultValue="network">
        <Tabs.List>
          <Tabs.Tab value="network">Network</Tabs.Tab>
        <Tabs.Tab value="non-network">Other Assets</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="network" pt="md">
        <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
              <TextInput
                placeholder="Search alias, hostname, IP..."
                leftSection={<Search size={16} strokeWidth={1.5} />}
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.currentTarget.value)}
                w="100%"
              />
              <Select
                placeholder="Criticality"
                data={[{ value: ALL, label: 'All criticalities' }, ...CRITICALITY_OPTIONS]}
                value={assetCriticality}
                onChange={(v) => setAssetCriticality(v ?? ALL)}
                w="100%"
              />
              <Select
                placeholder="Status"
                data={[{ value: ALL, label: 'All statuses' }, ...ASSET_STATUS_OPTIONS]}
                value={assetStatus}
                onChange={(v) => setAssetStatus(v ?? ALL)}
                w="100%"
              />
              <Select
                placeholder="Identified"
                data={[
                  { value: ALL, label: 'All' },
                  { value: 'true', label: 'Identified' },
                  { value: 'false', label: 'Not identified' },
                ]}
                value={assetIdentified}
                onChange={(v) => setAssetIdentified(v ?? ALL)}
                w="100%"
              />
            </SimpleGrid>
            <DataTable
              columns={assetsColumns}
              data={activeAssets}
              isLoading={assetsPending}
              emptyLabel="No assets match these filters"
              minWidth={980}
            />
            {inactiveAssets.length > 0 && (
              <>
                {/* Fila congelada al momento en que se detectó (ver useFrozenBucket) — un asset
                    retirado/offline no salta acá solo, hace falta recargar la página. */}
                <Divider label="Retired & Offline" labelPosition="left" mt="md" />
                <DataTable
                  columns={assetsColumns}
                  data={inactiveAssets}
                  emptyLabel="No retired or offline assets"
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
                  placeholder="Search alias..."
                  leftSection={<Search size={16} strokeWidth={1.5} />}
                  value={nnaSearch}
                  onChange={(e) => setNnaSearch(e.currentTarget.value)}
                  w="100%"
                />
                <Select
                  placeholder="Category"
                  data={[{ value: ALL, label: 'All categories' }, ...ASSET_CATEGORY_OPTIONS]}
                  value={nnaCategory}
                  onChange={(v) => setNnaCategory(v ?? ALL)}
                  w="100%"
                />
                <Select
                  placeholder="Criticality"
                  data={[{ value: ALL, label: 'All criticalities' }, ...CRITICALITY_OPTIONS]}
                  value={nnaCriticality}
                  onChange={(v) => setNnaCriticality(v ?? ALL)}
                  w="100%"
                />
                <Select
                  placeholder="Review"
                  data={[
                    { value: ALL, label: 'All review statuses' },
                    { value: 'ok', label: 'Up to date' },
                    { value: 'overdue', label: 'Review overdue' },
                  ]}
                  value={nnaReviewStatus}
                  onChange={(v) => setNnaReviewStatus(v ?? ALL)}
                  w="100%"
                />
              </SimpleGrid>
              <Button
                leftSection={<Plus size={16} strokeWidth={1.5} />}
                onClick={() => setEditingAsset(null)}
                w={{ base: '100%', sm: 'auto' }}
              >
                New asset
              </Button>
            </Group>
            <DataTable
              columns={nonNetworkAssetsColumns}
              data={activeNonNetworkAssets}
              isLoading={nonNetworkAssetsPending}
              emptyLabel="No manually tracked assets match these filters"
              minWidth={880}
            />
            {inactiveNonNetworkAssets.length > 0 && (
              <>
                <Divider label="Retired" labelPosition="left" mt="md" />
                <DataTable
                  columns={nonNetworkAssetsColumns}
                  data={inactiveNonNetworkAssets}
                  emptyLabel="No retired assets"
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
        title={editingAsset ? 'Edit asset' : 'New asset'}
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
  );
}
