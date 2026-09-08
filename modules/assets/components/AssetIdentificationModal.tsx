'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import type { Asset } from '@/app/types/payload-types'
import { CRITICALITY_OPTIONS } from '@/lib/enum-labels'
import {
  AssetIdentificationFormSchema,
  type AssetIdentificationForm,
  normalizeAssetIdentificationForm,
  UNKNOWN_IDENTIFICATION_VALUE,
} from '../schema'
import { useIdentifyAsset } from '../hooks/use-identify-asset'
import { SCANNED_ASSET_TYPE_OPTIONS } from '@/domain/assets/asset-types'

export function AssetIdentificationModal({
  asset,
  members,
  opened,
  onClose,
}: {
  asset: Asset
  members: Array<{ id: string; name: string; email: string }>
  opened: boolean
  onClose: () => void
}) {
  const identify = useIdentifyAsset()
  const suggestedType =
    asset.inferred_type && asset.inferred_type !== 'unknown' ? asset.inferred_type : null
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AssetIdentificationForm>({
    resolver: zodResolver(AssetIdentificationFormSchema),
    defaultValues: {
      confirmed_type: (asset.confirmed_type ??
        suggestedType ??
        'other') as AssetIdentificationForm['confirmed_type'],
      authorization_status:
        asset.authorization_status === 'unauthorized' ? 'unauthorized' : 'authorized',
      owner:
        typeof asset.owner === 'string'
          ? asset.owner
          : (asset.owner?.id ?? UNKNOWN_IDENTIFICATION_VALUE),
      criticality: asset.criticality ?? UNKNOWN_IDENTIFICATION_VALUE,
      alias: asset.alias ?? null,
      location: asset.location ?? null,
    },
  })
  const authorizationStatus = watch('authorization_status')
  const suggestionMessage = asset.is_scanner_host
    ? 'Classification evidence: this device hosts the SIAM scanner.'
    : asset.inferred_type === 'gateway'
      ? 'Classification evidence: this device matches the network gateway.'
      : asset.inference_confidence === 'unknown'
        ? 'The scan did not provide enough evidence to suggest a device type.'
        : `Suggested classification: ${suggestedType ?? 'not determined'} (${asset.inference_confidence ?? 'unknown'} confidence).`

  useEffect(() => {
    if (!opened) reset()
  }, [opened, reset])

  const submit = handleSubmit(formValue => {
    const identification = normalizeAssetIdentificationForm(formValue)
    identify.mutate({ id: String(asset.id), identification }, { onSuccess: onClose })
  })

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text component="span" size="lg" fw={700}>
          {asset.identification_status === 'confirmed'
            ? 'Edit asset identification'
            : 'Asset identification'}
        </Text>
      }
      centered
      size="lg"
    >
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {suggestionMessage} Review the classification and complete the available business
            information.
          </Text>
          {authorizationStatus === 'unauthorized' && (
            <Text size="sm" c="orange.8">
              An unauthorized device has no assigned owner or business criticality. Those fields
              will be cleared when you save.
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Controller
              name="confirmed_type"
              control={control}
              render={({ field }) => (
                <Select
                  label="Device type"
                  data={[...SCANNED_ASSET_TYPE_OPTIONS]}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.confirmed_type?.message}
                />
              )}
            />
            <Controller
              name="authorization_status"
              control={control}
              render={({ field }) => (
                <Select
                  label="Authorization status"
                  data={[
                    { value: 'authorized', label: 'Authorized' },
                    { value: 'unauthorized', label: 'Not authorized' },
                  ]}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.authorization_status?.message}
                />
              )}
            />
            {authorizationStatus === 'authorized' && (
              <>
                <Controller
                  name="owner"
                  control={control}
                  render={({ field }) => (
                    <Select
                      label="Asset owner"
                      searchable
                      data={[
                        {
                          value: UNKNOWN_IDENTIFICATION_VALUE,
                          label: 'Unassigned or unknown',
                        },
                        ...members.map(member => ({
                          value: member.id,
                          label: member.name || member.email,
                        })),
                      ]}
                      value={field.value ?? UNKNOWN_IDENTIFICATION_VALUE}
                      onChange={field.onChange}
                      error={errors.owner?.message}
                    />
                  )}
                />
                <Controller
                  name="criticality"
                  control={control}
                  render={({ field }) => (
                    <Select
                      label="Business criticality"
                      data={[
                        { value: UNKNOWN_IDENTIFICATION_VALUE, label: 'Not yet assessed' },
                        ...CRITICALITY_OPTIONS,
                      ]}
                      value={field.value ?? UNKNOWN_IDENTIFICATION_VALUE}
                      onChange={field.onChange}
                      error={errors.criticality?.message}
                    />
                  )}
                />
              </>
            )}
            <Controller
              name="alias"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Alias (optional)"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  error={errors.alias?.message}
                />
              )}
            />
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Location (optional)"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  error={errors.location?.message}
                />
              )}
            />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={identify.isPending}>
              Confirm asset
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
