'use client'

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
        <Divider label="Security assessment scope" labelPosition="left" />
        <Text size="sm" c="dimmed">
          Excluded assets stay in inventory but do not affect reviews or Risk Score.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Controller
            name="assessment_scope"
            control={control}
            render={({ field }) => (
              <Select
                label="Security assessment scope"
                data={[
                  { value: 'included', label: 'Included' },
                  { value: 'excluded', label: 'Excluded' },
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
                  label="Exclusion reason"
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
                  label="Excluded until"
                  description="Leave empty for an exclusion without expiration."
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
                label="Exclusion note"
                description="Add context for reviewers when useful."
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
            {asset ? 'Save changes' : 'Create asset'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
