'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useOrganizationSettings } from '@/modules/organization-settings/hooks/use-organization-settings'
import { useSaveOrganizationSettings } from '@/modules/organization-settings/hooks/use-save-organization-settings'
import { OrganizationSettingsFormSchema } from '@/modules/organization-settings/schema'
import type { OrganizationSettingsFormValues } from '@/modules/organization-settings/service'
import { useUpdateAssessmentPolicy } from '@/modules/assessments/hooks/use-update-assessment-policy'
import { useState } from 'react'
import { Badge, Modal, SimpleGrid } from '@mantine/core'

const OFFLINE_AFTER_HOURS_OPTIONS = [
  { value: '24', label: '1 day (24h)' },
  { value: '48', label: '2 days (48h)' },
  { value: '72', label: '3 days (72h) — platform default' },
  { value: '96', label: '4 days (96h)' },
  { value: '168', label: '7 days (168h)' },
]

const SNAPSHOT_INTERVAL_DAYS_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days — platform default' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
]

export default function AdminSettingsPage() {
  const { data: settings, isPending } = useOrganizationSettings()
  const save = useSaveOrganizationSettings()
  const policy = useUpdateAssessmentPolicy()
  const [pendingPolicy, setPendingPolicy] = useState<'essential' | 'reinforced' | null>(null)

  return (
    <Stack gap="md">
      <PageHeader title="Settings" description="Inventory settings for your organization." />
      <Card withBorder padding="lg" w="100%">
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
      {settings && (
        <Card withBorder padding="lg" w="100%">
          <Stack gap="md">
            <div>
              <Text fw={700}>Security review policy</Text>
              <Text size="sm" c="dimmed">
                Choose how often the company revisits its everyday security routines.
              </Text>
            </div>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {[
                {
                  key: 'essential' as const,
                  name: 'Essential',
                  cadence: 'Yearly',
                  detail:
                    'A shorter review covering the routines every small business should know.',
                },
                {
                  key: 'reinforced' as const,
                  name: 'Reinforced',
                  cadence: 'Every 6 months',
                  detail: 'Adds access reviews, recovery tests and closer network organization.',
                },
              ].map(option => (
                <Card
                  key={option.key}
                  withBorder
                  radius="md"
                  p="md"
                  style={
                    settings.assessment_policy_key === option.key
                      ? { borderColor: 'var(--mantine-color-pine-6)' }
                      : undefined
                  }
                >
                  <Group justify="space-between">
                    <Text fw={650}>{option.name}</Text>
                    <Badge color="pine" variant="light">
                      {option.cadence}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed" my="sm">
                    {option.detail}
                  </Text>
                  <Button
                    variant={settings.assessment_policy_key === option.key ? 'light' : 'default'}
                    disabled={settings.assessment_policy_key === option.key}
                    onClick={() => setPendingPolicy(option.key)}
                  >
                    Choose {option.name}
                  </Button>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        </Card>
      )}
      <Modal
        opened={pendingPolicy !== null}
        onClose={() => setPendingPolicy(null)}
        title="Change review policy?"
        centered
      >
        <Stack>
          <Text size="sm">
            This opens new review cycles under the selected policy. Completed reviews remain
            unchanged.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingPolicy(null)}>
              Cancel
            </Button>
            <Button
              color="pine"
              loading={policy.isPending}
              onClick={() =>
                pendingPolicy &&
                policy.mutate(
                  { policy_key: pendingPolicy, policy_version: 1 },
                  { onSuccess: () => setPendingPolicy(null) }
                )
              }
            >
              Confirm change
            </Button>
          </Group>
        </Stack>
      </Modal>
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
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<OrganizationSettingsFormValues>({
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
              <Select
                label="Offline threshold"
                description="An active asset not seen in a scan for this long is marked offline."
                placeholder="Platform default"
                data={OFFLINE_AFTER_HOURS_OPTIONS}
                value={field.value != null ? String(field.value) : null}
                onChange={v => field.onChange(v ? Number(v) : null)}
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
              <Select
                label="Snapshot interval"
                description="Minimum time between automatic snapshots."
                placeholder="Platform default"
                data={SNAPSHOT_INTERVAL_DAYS_OPTIONS}
                disabled={beforeEachScan}
                value={field.value != null ? String(field.value) : null}
                onChange={v => field.onChange(v ? Number(v) : null)}
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
        <Group justify="flex-end" wrap="wrap">
          <Button
            type="button"
            variant="subtle"
            disabled={alreadyAtDefaults}
            loading={saving}
            onClick={restoreDefaults}
            w={{ base: '100%', sm: 'auto' }}
          >
            Restore defaults
          </Button>
          <Button type="submit" loading={saving} w={{ base: '100%', sm: 'auto' }}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
