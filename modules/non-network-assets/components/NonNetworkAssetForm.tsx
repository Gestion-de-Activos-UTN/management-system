'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Box,
  Autocomplete,
  Button,
  Divider,
  Group,
  Select,
  SimpleGrid,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { memberCoversOffice } from '@/modules/users/service'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import {
  NO_OWNER_LABEL,
  CRITICALITY_OPTIONS,
  NON_NETWORK_ASSET_STATUS_OPTIONS,
  REVIEW_INTERVAL_OPTIONS,
  ASSESSMENT_EXCLUSION_REASON_OPTIONS,
  CLOUD_ASSET_KIND_OPTIONS,
  REPOSITORY_KIND_OPTIONS,
} from '@/lib/enum-labels'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { categoryHasSoftware, MANUAL_ASSET_CATEGORY_GROUPS } from '@/domain/assets/asset-types'
import { categoryGroupOf } from '@/collections/NonNetworkAssets/categoryGroups'
import { createNonNetworkAssetSchema, type NonNetworkAssetFormValues } from '../schema'
import { useSaveNonNetworkAsset } from '../hooks/use-save-non-network-asset'
import { useSoftwareSuggestions } from '../hooks/use-software-suggestions'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'
import {
  AssessmentExclusionFields,
  AssessmentScopeHint,
} from '@/modules/assessments/components/AssessmentExclusionFields'

const NO_OWNER = '__no_owner__'

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
    setValue,
    formState: { errors },
  } = useForm<NonNetworkAssetFormValues>({
    mode: 'onChange',
    resolver: zodResolver(createNonNetworkAssetSchema(asset)),
    defaultValues: {
      alias: asset?.alias ?? '',
      asset_category: asset?.asset_category,
      criticality: asset?.criticality ?? 'medium',
      // En el alta '' obliga a elegir; al editar un activo sin responsable se conserva el null.
      owner: asset
        ? relationIdOf(asset.owner as string | { id: string } | null | undefined) || null
        : '',
      location: asset?.location ?? '',
      status: asset?.status ?? 'active',
      office: relationIdOf(asset?.office as string | { id: string } | null | undefined),
      product_details: {
        software_vendor: asset?.product_details?.software_vendor ?? null,
        software_product: asset?.product_details?.software_product ?? null,
        software_version: asset?.product_details?.software_version ?? null,
      },
      cloud_details: {
        kind: asset?.cloud_details?.kind ?? null,
        vendor: asset?.cloud_details?.vendor ?? null,
      },
      repository_details: {
        kind: asset?.repository_details?.kind ?? null,
      },
      notes: asset?.notes ?? null,
      review_interval: asset?.review_interval ?? 'never',
      assessment_scope: asset?.assessment_scope ?? 'included',
      assessment_exclusion_reason: asset?.assessment_exclusion_reason ?? null,
      assessment_exclusion_note: asset?.assessment_exclusion_note ?? null,
      assessment_excluded_until: asset?.assessment_excluded_until ?? null,
    },
  })
  const assetCategory = watch('asset_category')
  const categoryGroup = categoryGroupOf(assetCategory)
  const hasSoftware = categoryHasSoftware(assetCategory)
  const { data: suggestions } = useSoftwareSuggestions({ asOrganization, enabled: hasSoftware })
  const assessmentScope = watch('assessment_scope')
  const exclusionReason = watch('assessment_exclusion_reason')
  const selectedOffice = watch('office')
  const selectedOwner = watch('owner')
  const eligibleOwners = selectedOffice
    ? (members ?? []).filter(member => memberCoversOffice(member, selectedOffice))
    : []

  const originalOffice = relationIdOf(asset?.office as string | { id: string } | null | undefined)
  useEffect(() => {
    if (!members || !selectedOffice) return
    // Cambiar de oficina obliga a elegir un responsable que la cubra, también si no tenía.
    const ownerless = selectedOwner === null && selectedOffice !== originalOffice
    const uncovered =
      Boolean(selectedOwner) && !eligibleOwners.some(member => member.id === selectedOwner)
    if (ownerless || uncovered) {
      setValue('owner', '', { shouldDirty: true, shouldValidate: true })
    }
  }, [eligibleOwners, members, originalOffice, selectedOffice, selectedOwner, setValue])

  const onSubmit = handleSubmit(values => {
    save.mutate(values, { onSuccess: onSaved })
  })

  // Este bloque es redundante porque lo limpia el backend
  /* const onSubmit = handleSubmit(values => {
    const payload: NonNetworkAssetFormValues = {
      ...values,
      product_details: categoryGroup === 'product_details' ? values.product_details : undefined,
      cloud_details: categoryGroup === 'cloud_details' ? values.cloud_details : undefined,
      repository_details:
        categoryGroup === 'repository_details' ? values.repository_details : undefined,
    }
    save.mutate(payload, { onSuccess: onSaved })
  }) */

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
      <ModalLayout
        gap="md"
        footer={
          <Group justify="flex-end">
            <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }}>
              {asset ? 'Guardar cambios' : 'Crear activo'}
            </Button>
          </Group>
        }
      >
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
                label="Categoría"
                required
                placeholder="Busca o selecciona una categoría"
                searchable
                clearable
                nothingFoundMessage="No se encontró ninguna categoría"
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
        </SimpleGrid>
        {categoryGroup === 'product_details' && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Controller
              name="product_details.software_vendor"
              control={control}
              render={({ field }) => (
                <Autocomplete
                  label="Proveedor"
                  required
                  // El error conocido de esta feature: el usuario escribe el producto donde va
                  // el fabricante. El placeholder es la mitigación barata; el autocompletado es
                  // la otra. No se elimina, se reduce.
                  placeholder="Canonical, no Ubuntu"
                  data={suggestions?.vendors ?? []}
                  value={field.value ?? ''}
                  onChange={value => field.onChange(value || null)}
                  error={errors.product_details?.software_vendor?.message}
                />
              )}
            />
            <Controller
              name="product_details.software_product"
              control={control}
              render={({ field }) => (
                <Autocomplete
                  label="Producto"
                  required
                  placeholder="Busca o escribe un producto"
                  data={suggestions?.products ?? []}
                  value={field.value ?? ''}
                  onChange={value => field.onChange(value || null)}
                  error={errors.product_details?.software_product?.message}
                />
              )}
            />
            <Controller
              name="product_details.software_version"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Versión"
                  placeholder="Opcional"
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.currentTarget.value || null)}
                  error={errors.product_details?.software_version?.message}
                />
              )}
            />
          </SimpleGrid>
        )}
        {categoryGroup === 'cloud_details' && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Controller
              name="cloud_details.kind"
              control={control}
              render={({ field }) => (
                <Select
                  label="Tipo de servicio cloud"
                  required
                  data={[...CLOUD_ASSET_KIND_OPTIONS]}
                  value={field.value ?? null}
                  onChange={value => field.onChange(value || null)}
                  error={errors.cloud_details?.kind?.message}
                />
              )}
            />
            <Controller
              name="cloud_details.vendor"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Proveedor"
                  placeholder="Opcional"
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.currentTarget.value || null)}
                  error={errors.cloud_details?.vendor?.message}
                />
              )}
            />
          </SimpleGrid>
        )}
        {categoryGroup === 'repository_details' && (
          <Controller
            name="repository_details.kind"
            control={control}
            render={({ field }) => (
              <Select
                label="Tipo de repositorio"
                required
                data={[...REPOSITORY_KIND_OPTIONS]}
                value={field.value ?? null}
                onChange={value => field.onChange(value || null)}
                error={errors.repository_details?.kind?.message}
              />
            )}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Controller
            name="criticality"
            control={control}
            render={({ field }) => (
              <Select
                label="Criticidad"
                required
                data={CRITICALITY_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'medium')}
                error={errors.criticality?.message}
              />
            )}
          />
          <Controller
            name="review_interval"
            control={control}
            render={({ field }) => (
              <Select
                label="Frecuencia de revisión"
                required
                description="Cada cuánto debe volver a confirmarse este activo"
                data={REVIEW_INTERVAL_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'never')}
                error={errors.review_interval?.message}
              />
            )}
          />
          <Controller
            name="office"
            control={control}
            render={({ field }) => (
              <Select
                label="Oficina"
                required
                data={(offices ?? []).map(o => ({ value: String(o.id), label: o.name }))}
                value={field.value || null}
                onChange={field.onChange}
                error={errors.office?.message}
              />
            )}
          />
          <Controller
            name="owner"
            control={control}
            render={({ field }) => (
              <MemberSelect
                label="Responsable"
                members={eligibleOwners}
                // Visible para entender el estado, nunca elegible: sólo el sistema lo asigna.
                emptyOption={{ value: NO_OWNER, label: NO_OWNER_LABEL, disabled: true }}
                required
                placeholder={
                  selectedOffice
                    ? 'Selecciona un responsable de esta oficina'
                    : 'Selecciona primero una oficina'
                }
                value={field.value === null ? NO_OWNER : field.value || null}
                onChange={value => field.onChange(value === NO_OWNER ? null : value)}
                disabled={!selectedOffice}
                error={errors.owner?.message}
              />
            )}
          />
          <Controller
            name="location"
            control={control}
            render={({ field }) => (
              <TextInput
                label="Ubicación"
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
                label="Estado"
                required
                data={NON_NETWORK_ASSET_STATUS_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'active')}
                error={errors.status?.message}
              />
            )}
          />
        </SimpleGrid>
        <Controller
          name="notes"
          control={control}
          render={({ field }) => (
            <Textarea
              label="Observaciones"
              value={field.value ?? ''}
              onChange={e => field.onChange(e.currentTarget.value || null)}
              error={errors.notes?.message}
            />
          )}
        />
        <Divider label="Alcance de la evaluación de seguridad" labelPosition="left" />
        <Box w={{ base: '100%', sm: '50%' }}>
          <Controller
            name="assessment_scope"
            control={control}
            render={({ field }) => (
              <Select
                label="Alcance de la evaluación de seguridad"
                required
                data={[
                  { value: 'included', label: 'Incluido' },
                  { value: 'excluded', label: 'Excluido' },
                ]}
                value={field.value}
                error={errors.assessment_scope?.message}
                onChange={value => field.onChange(value ?? 'included')}
              />
            )}
          />
        </Box>
        <AssessmentScopeHint />
        <AssessmentExclusionFields
          control={control}
          errors={errors}
          excluded={assessmentScope === 'excluded'}
          noteRequired={exclusionReason === 'other'}
        />
      </ModalLayout>
    </form>
  )
}
