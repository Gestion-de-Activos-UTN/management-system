'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Autocomplete, Button, Group, Select, SimpleGrid, Stack, TextInput } from '@mantine/core'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import {
  CRITICALITY_OPTIONS,
  NON_NETWORK_ASSET_STATUS_OPTIONS,
  REVIEW_INTERVAL_OPTIONS,
} from '@/lib/enum-labels'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { categoryHasSoftware, MANUAL_ASSET_CATEGORY_GROUPS } from '@/domain/assets/asset-types'
import { NonNetworkAssetSchema, type NonNetworkAssetFormValues } from '../schema'
import { useSaveNonNetworkAsset } from '../hooks/use-save-non-network-asset'
import { useSoftwareSuggestions } from '../hooks/use-software-suggestions'

function relationIdOf(value: string | { id: string } | null | undefined): string {
  if (!value) return ''
  return typeof value === 'string' ? value : value.id
}

export function NonNetworkAssetForm({
  asset,
  asOrganization,
  onSaved,
}: {
  asset?: NonNetworkAsset
  asOrganization?: string
  onSaved?: () => void
}) {
  const { data: offices } = useOfficesList(asOrganization)
  const { data: members } = useOrgMembers(asOrganization)
  const save = useSaveNonNetworkAsset(asset?.id)

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NonNetworkAssetFormValues>({
    resolver: zodResolver(NonNetworkAssetSchema),
    defaultValues: {
      alias: asset?.alias ?? '',
      asset_category: asset?.asset_category,
      criticality: asset?.criticality ?? 'medium',
      owner: relationIdOf(asset?.owner as string | { id: string } | null | undefined),
      location: asset?.location ?? '',
      status: asset?.status ?? 'active',
      office: relationIdOf(asset?.office as string | { id: string } | null | undefined),
      software_vendor: asset?.software_vendor ?? null,
      software_product: asset?.software_product ?? null,
      software_version: asset?.software_version ?? null,
      review_interval: asset?.review_interval ?? 'never',
    },
  })

  const hasSoftware = categoryHasSoftware(watch('asset_category'))
  const { data: suggestions } = useSoftwareSuggestions({ asOrganization, enabled: hasSoftware })

  const onSubmit = handleSubmit(values => {
    save.mutate(values, { onSuccess: onSaved })
  })

  return (
    // noValidate: `required` below is kept ONLY for the visual asterisk. Without this, the
    // browser's native constraint validation intercepts submit on the first native <input>
    // it finds invalid (here, Alias) and shows its own popup — stopping right there, before
    // handleSubmit's zodResolver ever runs, so no other field gets a chance to show its error.
    // Mantine's Select isn't a native <input required>, so it never triggered that popup,
    // which is why office/owner already looked consistent while Alias didn't. Disabling native
    // validation makes RHF+Zod the single source of truth, which already reports every invalid
    // field in one pass, not just the first.
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Controller
            name="alias"
            control={control}
            render={({ field }) => (
              <TextInput
                label="Alias"
                required
                value={field.value}
                onChange={e => field.onChange(e.currentTarget.value)}
                error={errors.alias?.message}
              />
            )}
          />
          <Controller
            name="asset_category"
            control={control}
            render={({ field }) => (
              <Select
                label="Category"
                placeholder="Search or select a category"
                searchable
                clearable
                nothingFoundMessage="No category found"
                data={MANUAL_ASSET_CATEGORY_GROUPS.map(group => ({
                  group: group.group,
                  items: [...group.items],
                }))}
                value={field.value ?? null}
                onChange={field.onChange}
                error={errors.asset_category?.message}
              />
            )}
          />
          {/* Solo en las categorías que declaran software. Al cambiar a una que no lo declara, el
              beforeChange del server limpia los valores — no hace falta resetearlos acá. */}
          {hasSoftware && (
            <>
              <Controller
                name="software_vendor"
                control={control}
                render={({ field }) => (
                  <Autocomplete
                    label="Vendor"
                    // El error conocido de esta feature: el usuario escribe el producto donde va
                    // el fabricante. El placeholder es la mitigación barata; el autocompletado es
                    // la otra. No se elimina, se reduce.
                    placeholder="Canonical, not Ubuntu"
                    data={suggestions?.vendors ?? []}
                    value={field.value ?? ''}
                    // '' vuelve a null: el campo es nullable en el schema y en la colección, y una
                    // cadena vacía ensuciaría el filtro `exists` del endpoint de sugerencias.
                    onChange={value => field.onChange(value || null)}
                    error={errors.software_vendor?.message}
                  />
                )}
              />
              <Controller
                name="software_product"
                control={control}
                render={({ field }) => (
                  <Autocomplete
                    label="Product"
                    placeholder="Search or type a product"
                    data={suggestions?.products ?? []}
                    value={field.value ?? ''}
                    onChange={value => field.onChange(value || null)}
                    error={errors.software_product?.message}
                  />
                )}
              />
              <Controller
                name="software_version"
                control={control}
                render={({ field }) => (
                  <TextInput
                    label="Version"
                    placeholder="Optional"
                    value={field.value ?? ''}
                    onChange={e => field.onChange(e.currentTarget.value || null)}
                    error={errors.software_version?.message}
                  />
                )}
              />
            </>
          )}
          <Controller
            name="criticality"
            control={control}
            render={({ field }) => (
              <Select
                label="Criticality"
                data={CRITICALITY_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'medium')}
                error={errors.criticality?.message}
              />
            )}
          />
          <Controller
            name="owner"
            control={control}
            render={({ field }) => (
              <Select
                label="Owner"
                required
                placeholder="Select owner"
                data={(members ?? []).map(m => ({ value: m.id, label: m.name || m.email }))}
                value={field.value || null}
                onChange={field.onChange}
                searchable
                error={errors.owner?.message}
              />
            )}
          />
          <Controller
            name="office"
            control={control}
            render={({ field }) => (
              <Select
                label="Office"
                required
                data={(offices ?? []).map(o => ({ value: String(o.id), label: o.name }))}
                value={field.value || null}
                onChange={field.onChange}
                error={errors.office?.message}
              />
            )}
          />
          <Controller
            name="location"
            control={control}
            render={({ field }) => (
              <TextInput
                label="Location"
                value={field.value ?? ''}
                onChange={e => field.onChange(e.currentTarget.value)}
                error={errors.location?.message}
              />
            )}
          />
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <Select
                label="Status"
                // Espacio invisible: reserva la misma altura de línea que la description de
                // "Review recurrence" (su vecino en la misma fila del grid) para que ambos
                // Select queden alineados en vez de que este quede más arriba por no tener una.
                description=" "
                data={NON_NETWORK_ASSET_STATUS_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'active')}
                error={errors.status?.message}
              />
            )}
          />
          <Controller
            name="review_interval"
            control={control}
            render={({ field }) => (
              <Select
                label="Review recurrence"
                description="How often this asset needs to be reconfirmed"
                data={REVIEW_INTERVAL_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'never')}
                error={errors.review_interval?.message}
              />
            )}
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }}>
            {asset ? 'Save changes' : 'Create asset'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
