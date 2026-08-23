'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Checkbox, Divider, Group, NumberInput, Skeleton, Stack, Text } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useOrganizationSettings } from '@/modules/organization-settings/hooks/use-organization-settings'
import { useSaveOrganizationSettings } from '@/modules/organization-settings/hooks/use-save-organization-settings'
import { OrganizationSettingsFormSchema } from '@/modules/organization-settings/schema'
import type { OrganizationSettingsFormValues } from '@/modules/organization-settings/service'

export default function AdminSettingsPage() {
  const { data: settings, isPending } = useOrganizationSettings()
  const save = useSaveOrganizationSettings()

  return (
    <Stack gap="md">
      <PageHeader title="Settings" description="Inventory settings for your organization." />
      <Card withBorder padding="lg">
        {isPending || !settings ? (
          <Stack gap="sm">
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : (
          <SettingsForm
            initial={{
              offline_after_hours: settings.offline_after_hours ?? null,
              snapshot_before_each_scan: settings.snapshot_before_each_scan ?? false,
              snapshot_interval_days: settings.snapshot_interval_days ?? null,
            }}
            onSave={values => save.mutate(values)}
            saving={save.isPending}
          />
        )}
      </Card>
    </Stack>
  )
}

function SettingsForm({
  initial,
  onSave,
  saving,
}: {
  initial: OrganizationSettingsFormValues
  onSave: (values: OrganizationSettingsFormValues) => void
  saving: boolean
}) {
  const { control, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<OrganizationSettingsFormValues>({
    resolver: zodResolver(OrganizationSettingsFormSchema),
    defaultValues: initial,
  })
  const beforeEachScan = watch('snapshot_before_each_scan')
  const offlineAfterHours = watch('offline_after_hours')
  const snapshotIntervalDays = watch('snapshot_interval_days')
  const alreadyAtDefaults = offlineAfterHours == null && snapshotIntervalDays == null

  const restoreDefaults = () => {
    setValue('offline_after_hours', null, { shouldDirty: true })
    setValue('snapshot_interval_days', null, { shouldDirty: true })
    onSave({ ...getValues(), offline_after_hours: null, snapshot_interval_days: null })
  }

  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <Stack gap="md">
        <Text size="sm" fw={600}>
          Aging
        </Text>
        <Controller
          name="offline_after_hours"
          control={control}
          render={({ field }) => (
            <Stack gap={4}>
              <NumberInput
                label="Offline threshold (hours)"
                description="An active asset not seen in a scan for this long is marked offline."
                min={1}
                step={1}
                value={field.value ?? ''}
                onChange={v => field.onChange(typeof v === 'number' ? v : null)}
                error={errors.offline_after_hours?.message}
              />
              {field.value == null && (
                <Text size="xs" c="dimmed">
                  Using the platform default (72hs).
                </Text>
              )}
            </Stack>
          )}
        />

        <Divider />

        <Text size="sm" fw={600}>
          Snapshots
        </Text>
        <Controller
          name="snapshot_before_each_scan"
          control={control}
          render={({ field }) => (
            <Checkbox
              label="Take a snapshot before every scan"
              description="When on, ignores the interval below and takes a snapshot on every processed scan."
              checked={field.value}
              onChange={e => field.onChange(e.currentTarget.checked)}
            />
          )}
        />
        <Controller
          name="snapshot_interval_days"
          control={control}
          render={({ field }) => (
            <Stack gap={4}>
              <NumberInput
                label="Snapshot interval (days)"
                description="Minimum days between automatic snapshots."
                min={1}
                step={1}
                disabled={beforeEachScan}
                value={field.value ?? ''}
                onChange={v => field.onChange(typeof v === 'number' ? v : null)}
                error={errors.snapshot_interval_days?.message}
              />
              {field.value == null && !beforeEachScan && (
                <Text size="xs" c="dimmed">
                  Using the platform default (7 days).
                </Text>
              )}
            </Stack>
          )}
        />
        <Text size="xs" c="dimmed">
          These apply to every office in this organization.
        </Text>
        <Group justify="flex-end">
          <Button type="button" variant="subtle" disabled={alreadyAtDefaults} loading={saving} onClick={restoreDefaults}>
            Restore defaults
          </Button>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
