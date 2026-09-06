'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import type { Asset } from '@/app/types/payload-types'
import { CRITICALITY_OPTIONS } from '@/lib/enum-labels'
import { AssetIdentificationSchema, type AssetIdentification } from '../schema'
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
  } = useForm<AssetIdentification>({
    resolver: zodResolver(AssetIdentificationSchema),
    defaultValues: {
      confirmed_type: (asset.confirmed_type ??
        suggestedType ??
        'other') as AssetIdentification['confirmed_type'],
      authorization_status:
        asset.authorization_status === 'unauthorized' ? 'unauthorized' : 'authorized',
      owner: typeof asset.owner === 'string' ? asset.owner : (asset.owner?.id ?? null),
      criticality: asset.criticality ?? null,
      alias: asset.alias ?? null,
      location: asset.location ?? null,
    },
  })
  const authorizationStatus = watch('authorization_status')

  useEffect(() => {
    if (!opened) reset()
  }, [opened, reset])

  const submit = handleSubmit(identification => {
    identify.mutate({ id: String(asset.id), identification }, { onSuccess: onClose })
  })

  return (
    <Modal opened={opened} onClose={onClose} title="Identify asset" centered size="lg">
      <form onSubmit={submit} noValidate>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            SIAM suggests {suggestedType ?? 'no specific type'} with{' '}
            {asset.inference_confidence ?? 'unknown'} confidence. Confirm the device and its
            business context.
          </Text>
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
                  label="Is this device authorized?"
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
                      label="Owner"
                      placeholder="Unassigned"
                      searchable
                      clearable
                      data={members.map(member => ({
                        value: member.id,
                        label: member.name || member.email,
                      }))}
                      value={field.value ?? null}
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
                      label="Criticality"
                      placeholder="Unknown"
                      clearable
                      data={CRITICALITY_OPTIONS}
                      value={field.value ?? null}
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
              Confirm identification
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
