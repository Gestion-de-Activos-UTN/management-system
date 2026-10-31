'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
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
import { useSaveOrganizationMaturity } from '@/modules/organization-settings/hooks/use-save-organization-maturity'
import { MaturityProfileForm } from '@/modules/organization-settings/components/MaturityProfileForm'
import { RISK_CATALOG_V2 } from '@/domain/risk/catalog-v2'
import { useState } from 'react'
import { Modal, SimpleGrid } from '@mantine/core'

import {
  OFFLINE_AFTER_HOURS_OPTIONS,
  SNAPSHOT_INTERVAL_DAYS_OPTIONS,
} from '@/domain/organizations/settings-options'
import { StatusBadge } from '@/components/ui/StatusBadge'

export default function AdminSettingsPage() {
  const { data: settings, isPending } = useOrganizationSettings()
  const save = useSaveOrganizationSettings()
  const policy = useUpdateAssessmentPolicy()
  const maturity = useSaveOrganizationMaturity()
  const [pendingPolicy, setPendingPolicy] = useState<'essential' | 'reinforced' | null>(null)

  return (
    <Stack gap="md">
      <PageHeader
        title="Configuración"
        description="Configuración del inventario y del perfil de tu organización."
      />
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
            onSave={values => save.mutateAsync(values)}
            saving={save.isPending}
          />
        )}
      </Card>
      {settings && (
        <Card withBorder padding="lg" w="100%">
          <MaturityProfileForm
            initial={{
              maturity_it_owner: settings.maturity_it_owner ?? undefined,
              maturity_security_budget: settings.maturity_security_budget ?? undefined,
            }}
            updatedAt={settings.maturity_updated_at}
            onSave={values => maturity.mutate(values)}
            saving={maturity.isPending}
          />
        </Card>
      )}
      {settings && (
        <Card withBorder padding="lg" w="100%">
          <Stack gap="md">
            <div>
              <Text fw={700}>Política de revisión de seguridad</Text>
              <Text size="sm" c="dimmed">
                Elige cada cuánto la empresa revisará sus rutinas cotidianas de seguridad.
              </Text>
            </div>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              {[
                {
                  key: 'essential' as const,
                  name: 'Esencial',
                  cadence: 'Anual',
                  detail:
                    'Una revisión breve de las rutinas que toda pequeña empresa debería conocer.',
                },
                {
                  key: 'reinforced' as const,
                  name: 'Reforzada',
                  cadence: 'Cada 6 meses',
                  detail:
                    'Agrega revisiones de acceso, pruebas de recuperación y una organización más detallada de la red.',
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
                    <StatusBadge tone="info" label={option.cadence} />
                  </Group>
                  <Text size="sm" c="dimmed" my="sm">
                    {option.detail}
                  </Text>
                  {/* mt="auto": Card ya es flex-column; ancla el botón al pie aunque las
                      descripciones tengan distinto largo. */}
                  <Button
                    mt="auto"
                    variant={settings.assessment_policy_key === option.key ? 'light' : 'default'}
                    disabled={settings.assessment_policy_key === option.key}
                    onClick={() => setPendingPolicy(option.key)}
                  >
                    {settings.assessment_policy_key === option.key
                      ? 'Política actual'
                      : `Elegir ${option.name}`}
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
        title="¿Cambiar la política de revisión?"
        centered
      >
        <ModalLayout
          footer={
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPendingPolicy(null)}>
                Cancelar
              </Button>
              <Button
                color="pine"
                loading={policy.isPending}
                onClick={() =>
                  pendingPolicy &&
                  policy.mutate(
                    { policy_key: pendingPolicy, policy_version: RISK_CATALOG_V2.version },
                    { onSuccess: () => setPendingPolicy(null) }
                  )
                }
              >
                Confirmar cambio
              </Button>
            </Group>
          }
        >
          <Text size="sm">
            Esto abre nuevos ciclos de revisión con la política seleccionada. Las revisiones
            completadas no se modifican.
          </Text>
        </ModalLayout>
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
  onSave: (values: OrganizationSettingsFormValues) => Promise<unknown>
  saving: boolean
}) {
  const {
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<OrganizationSettingsFormValues>({
    resolver: zodResolver(OrganizationSettingsFormSchema),
    defaultValues: initial,
  })
  const [pendingAction, setPendingAction] = useState<'save' | 'restore' | null>(null)
  const busy = saving || pendingAction !== null
  const beforeEachScan = watch('snapshot_before_each_scan')
  const offlineAfterHours = watch('offline_after_hours')
  const snapshotIntervalDays = watch('snapshot_interval_days')
  const alreadyAtDefaults =
    offlineAfterHours == null && snapshotIntervalDays == null && !beforeEachScan

  const persist = async (values: OrganizationSettingsFormValues, action: 'save' | 'restore') => {
    if (busy) return
    setPendingAction(action)
    try {
      await onSave(values)
      // Reflejar lo guardado solo después de que el servidor lo confirme.
      reset(values)
    } catch {
      // El hook muestra el error; se conservan los valores para corregir o reintentar.
    } finally {
      setPendingAction(null)
    }
  }

  const restoreDefaults = () => {
    void persist(
      {
        offline_after_hours: null,
        snapshot_before_each_scan: false,
        snapshot_interval_days: null,
      },
      'restore'
    )
  }

  return (
    <form onSubmit={handleSubmit(values => persist(values, 'save'))} noValidate>
      <Stack gap="md">
        <Text size="sm" fw={600}>
          Antigüedad
        </Text>
        <Controller
          name="offline_after_hours"
          control={control}
          render={({ field }) => (
            <Stack gap={4}>
              <Select
                disabled={busy}
                label="Umbral sin conexión"
                description="Un activo que no aparezca en un escaneo durante este período se marcará como sin conexión."
                placeholder="Valor predeterminado de la plataforma"
                data={OFFLINE_AFTER_HOURS_OPTIONS}
                value={field.value != null ? String(field.value) : null}
                onChange={v => field.onChange(v ? Number(v) : null)}
                error={errors.offline_after_hours?.message}
              />
              {field.value == null && (
                <Text size="xs" c="dimmed">
                  Se usa el valor predeterminado de la plataforma (72 h).
                </Text>
              )}
            </Stack>
          )}
        />

        <Divider />

        <Text size="sm" fw={600}>
          Instantáneas
        </Text>
        <Controller
          name="snapshot_before_each_scan"
          control={control}
          render={({ field }) => (
            <Checkbox
              label="Tomar una instantánea antes de cada escaneo"
              description="Al activarlo, se ignora el intervalo siguiente y se toma una instantánea en cada escaneo procesado."
              disabled={busy}
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
                label="Intervalo entre instantáneas"
                description="Tiempo mínimo entre instantáneas automáticas."
                placeholder="Valor predeterminado de la plataforma"
                data={SNAPSHOT_INTERVAL_DAYS_OPTIONS}
                disabled={busy || beforeEachScan}
                value={field.value != null ? String(field.value) : null}
                onChange={v => field.onChange(v ? Number(v) : null)}
                error={errors.snapshot_interval_days?.message}
              />
              {field.value == null && !beforeEachScan && (
                <Text size="xs" c="dimmed">
                  Se usa el valor predeterminado de la plataforma (7 días).
                </Text>
              )}
            </Stack>
          )}
        />
        <Text size="xs" c="dimmed">
          Estas opciones se aplican a todas las oficinas de la organización.
        </Text>
        <Group justify="flex-end" wrap="wrap">
          <Button
            type="button"
            variant="subtle"
            disabled={busy || alreadyAtDefaults}
            loading={pendingAction === 'restore'}
            onClick={restoreDefaults}
            w={{ base: '100%', sm: 'auto' }}
          >
            Restaurar valores predeterminados
          </Button>
          <Button
            type="submit"
            disabled={busy}
            loading={pendingAction === 'save'}
            w={{ base: '100%', sm: 'auto' }}
          >
            Guardar cambios
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
