'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { BackButton } from '@/components/ui/BackButton';
import { useAsset } from '@/modules/assets/hooks/use-asset';
import { AssetDetailView } from '@/modules/assets/components/AssetDetailView';

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const backHref = `/portal/inventory${asOrganization ? `?asOrganization=${asOrganization}` : ''}`;
  const { data: asset, isPending, isError } = useAsset(id);

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    );
  }

  if (isError || !asset) {
    return (
      <Stack align="center" py="xl">
        <Text c="dimmed">Could not load this asset.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <BackButton href={backHref} label="Back to Inventory" />
      <AssetDetailView asset={asset} asOrganization={asOrganization} />
    </Stack>
  );
}
