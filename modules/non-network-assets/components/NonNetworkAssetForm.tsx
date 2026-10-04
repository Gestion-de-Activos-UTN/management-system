'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  Divider,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { memberCoversOffice } from '@/modules/users/service'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import {
  CRITICALITY_OPTIONS,
  NON_NETWORK_ASSET_STATUS_OPTIONS,
  REVIEW_INTERVAL_OPTIONS,
  ASSESSMENT_EXCLUSION_REASON_OPTIONS,
} from '@/lib/enum-labels'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { MANUAL_ASSET_CATEGORY_GROUPS } from '@/domain/assets/asset-types'
import { NonNetworkAssetSchema, type NonNetworkAssetFormValues } from '../schema'
import { useSaveNonNetworkAsset } from '../hooks/use-save-non-network-asset'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'

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
    resolver: zodResolver(NonNetworkAssetSchema),
    defaultValues: {
      alias: asset?.alias ?? '',
      asset_category: asset?.asset_category,
      criticality: asset?.criticality ?? 'medium',
      owner: relationIdOf(asset?.owner as string | { id: string } | null | undefined),
      location: asset?.location ?? '',
      status: asset?.status ?? 'active',
      office: relationIdOf(asset?.office as string | { id: string } | null | undefined),
      review_interval: asset?.review_interval ?? 'never',
      assessment_scope: asset?.assessment_scope ?? 'included',
      assessment_exclusion_reason: asset?.assessment_exclusion_reason ?? null,
      assessment_exclusion_note: asset?.assessment_exclusion_note ?? null,
      assessment_excluded_until: asset?.assessment_excluded_until ?? null,
    },
  })
  const assessmentScope = watch('assessment_scope')
  const exclusionReason = watch('assessment_exclusion_reason')
  const selectedOffice = watch('office')
  const selectedOwner = watch('owner')
  const eligibleOwners = selectedOffice
    ? (members ?? []).filter(member => memberCoversOffice(member, selectedOffice))
    : []

  useEffect(() => {
    if (!members || !selectedOwner || !selectedOffice) return
    if (!eligibleOwners.some(member => member.id === selectedOwner)) {
      setValue('owner', '', { shouldDirty: true, shouldValidate: true })
    }
  }, [eligibleOwners, members, selectedOffice, selectedOwner, setValue])

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
                label="Categoría"
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
          <Controller
            name="criticality"
            control={control}
            render={({ field }) => (
              <Select
                label="Criticidad"
                data={CRITICALITY_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'medium')}
                error={errors.criticality?.message}
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
                required
                placeholder={
                  selectedOffice
                    ? 'Selecciona un responsable de esta oficina'
                    : 'Selecciona primero una oficina'
                }
                value={field.value || null}
                onChange={field.onChange}
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
                label="Frecuencia de revisión"
                description="Cada cuánto debe volver a confirmarse este activo"
                data={REVIEW_INTERVAL_OPTIONS}
                value={field.value}
                onChange={v => field.onChange(v ?? 'never')}
                error={errors.review_interval?.message}
              />
            )}
          />
        </SimpleGrid>
        <Divider label="Alcance de la evaluación de seguridad" labelPosition="left" />
        <Text size="sm" c="dimmed">
          Los activos excluidos permanecen en el inventario, pero no afectan las revisiones ni el
          puntaje de riesgo.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Controller
            name="assessment_scope"
            control={control}
            render={({ field }) => (
              <Select
                label="Alcance de la evaluación de seguridad"
                data={[
                  { value: 'included', label: 'Incluido' },
                  { value: 'excluded', label: 'Excluido' },
                ]}
                value={field.value}
                onChange={value => field.onChange(value ?? 'included')}
              />
            )}
          />
          {assessmentScope === 'excluded' && (
            <Controller
              name="assessment_exclusion_reason"
              control={control}
              render={({ field }) => (
                <Select
                  label="Motivo de exclusión"
                  required
                  data={[...ASSESSMENT_EXCLUSION_REASON_OPTIONS]}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.assessment_exclusion_reason?.message}
                />
              )}
            />
          )}
          {assessmentScope === 'excluded' && (
            <Controller
              name="assessment_excluded_until"
              control={control}
              render={({ field }) => (
                <TextInput
                  type="date"
                  label="Excluido hasta"
                  description="Déjalo vacío para una exclusión sin vencimiento."
                  value={field.value ? formatDateInput(field.value) : ''}
                  onChange={event =>
                    field.onChange(
                      event.currentTarget.value
                        ? localDateEndToISOString(event.currentTarget.value)
                        : null
                    )
                  }
                />
              )}
            />
          )}
        </SimpleGrid>
        {assessmentScope === 'excluded' && (
          <Controller
            name="assessment_exclusion_note"
            control={control}
            render={({ field }) => (
              <Textarea
                label="Nota de exclusión"
                description="Agrega contexto para quienes revisen cuando sea útil."
                required={exclusionReason === 'other'}
                value={field.value ?? ''}
                onChange={field.onChange}
                error={errors.assessment_exclusion_note?.message}
              />
            )}
          />
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }}>
            {asset ? 'Guardar cambios' : 'Crear activo'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
