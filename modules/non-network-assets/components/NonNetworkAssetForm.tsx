'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Group, JsonInput, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useOfficesList } from '@/modules/offices/hooks/use-offices';
import { useOrgMembers } from '@/modules/users/hooks/use-org-members';
import { ASSET_CATEGORY_OPTIONS, CRITICALITY_OPTIONS, NON_NETWORK_ASSET_STATUS_OPTIONS } from '@/lib/enum-labels';
import type { NonNetworkAsset } from '@/app/types/payload-types';
import { NonNetworkAssetSchema, type NonNetworkAssetFormValues } from '../schema';
import { useSaveNonNetworkAsset } from '../hooks/use-save-non-network-asset';

function relationIdOf(value: string | { id: string } | null | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.id;
}

export function NonNetworkAssetForm({
  asset,
  asOrganization,
  onSaved,
}: {
  asset?: NonNetworkAsset;
  asOrganization?: string;
  onSaved?: () => void;
}) {
  const { data: offices } = useOfficesList(asOrganization);
  const { data: members } = useOrgMembers(asOrganization);
  const save = useSaveNonNetworkAsset(asset?.id);

  const { control, handleSubmit, formState: { errors } } = useForm<NonNetworkAssetFormValues>({
    resolver: zodResolver(NonNetworkAssetSchema),
    defaultValues: {
      alias: asset?.alias ?? '',
      asset_category: asset?.asset_category ?? 'other',
      criticality: asset?.criticality ?? 'medium',
      owner: relationIdOf(asset?.owner as string | { id: string } | null | undefined),
      location: asset?.location ?? '',
      status: asset?.status ?? 'active',
      office: relationIdOf(asset?.office as string | { id: string } | null | undefined),
      next_review_at: asset?.next_review_at ?? null,
      details: asset?.details ? JSON.stringify(asset.details, null, 2) : '{}',
    },
  });

  const onSubmit = handleSubmit((values) => {
    save.mutate(values, { onSuccess: onSaved });
  });

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
                onChange={(e) => field.onChange(e.currentTarget.value)}
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
                data={ASSET_CATEGORY_OPTIONS}
                value={field.value}
                onChange={(v) => field.onChange(v ?? 'other')}
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
                onChange={(v) => field.onChange(v ?? 'medium')}
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
                data={(members ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.email})` }))}
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
                data={(offices ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
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
                onChange={(e) => field.onChange(e.currentTarget.value)}
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
                data={NON_NETWORK_ASSET_STATUS_OPTIONS}
                value={field.value}
                onChange={(v) => field.onChange(v ?? 'active')}
                error={errors.status?.message}
              />
            )}
          />
          <Controller
            name="next_review_at"
            control={control}
            render={({ field }) => (
              // Native date input, not @mantine/dates (not an installed dependency, ponytail:
              // add it only if a real calendar-picker need shows up). Without an
              // OrganizationSettings.review_policy configured for the organization — there's no
              // UI to set one yet — this is the ONLY way next_review_at ever gets a value.
              <TextInput
                type="date"
                label="Next review (optional override)"
                value={field.value ? field.value.slice(0, 10) : ''}
                onChange={(e) =>
                  field.onChange(e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)
                }
                error={errors.next_review_at?.message}
              />
            )}
          />
        </SimpleGrid>
        <Controller
          name="details"
          control={control}
          render={({ field }) => (
            <JsonInput
              label="Details (free-form JSON per category)"
              description={`${field.value.length}/5000 characters`}
              autosize
              minRows={4}
              value={field.value}
              onChange={(value) => field.onChange(value.slice(0, 5000))}
              formatOnBlur
              validationError="Invalid JSON"
              error={errors.details?.message}
            />
          )}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {asset ? 'Save changes' : 'Create asset'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
