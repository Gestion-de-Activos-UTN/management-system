'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Center, Loader, Stack } from '@mantine/core'
import { ResourceError } from '@/components/ui/ResourceError'
import { BackButton } from '@/components/ui/BackButton'
import { useAsset } from '@/modules/assets/hooks/use-asset'
import { AssetDetailView } from '@/modules/assets/components/AssetDetailView'
import { portalHref } from '@/lib/portal-href'

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const backHref = portalHref('/portal/inventory', asOrganization)
  const { data: asset, isPending, isError, error, refetch, isFetching } = useAsset(id)

  if (isPending) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  }

  if (isError || !asset) {
    return (
      <ResourceError
        error={error}
        resource="este activo"
        backHref={backHref}
        backLabel="Volver al inventario"
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    )
  }

  return (
    <Stack gap="md">
      <BackButton href={backHref} label="Volver al inventario" />
      <AssetDetailView asset={asset} asOrganization={asOrganization} backHref={backHref} />
    </Stack>
  )
}
