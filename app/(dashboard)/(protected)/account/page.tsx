'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Card, Stack, Text, TextInput } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import {
  usePlatformAdminProfile,
  useUpdatePlatformAdminProfile,
} from '@/modules/auth/hooks/use-platform-admin-profile'
import {
  PlatformAdminProfileSchema,
  type PlatformAdminProfileInput,
} from '@/modules/auth/schema'

export default function AccountPage() {
  const { data: tenantContext } = useTenantContext()
  const profile = usePlatformAdminProfile()
  const updateProfile = useUpdatePlatformAdminProfile()
  const { control, handleSubmit, reset } = useForm<PlatformAdminProfileInput>({
    resolver: zodResolver(PlatformAdminProfileSchema),
    defaultValues: { name: '' },
  })

  useEffect(() => {
    if (profile.data) reset(profile.data)
  }, [profile.data, reset])

  return (
    <Stack gap="md">
      <PageHeader title="Configuración de la cuenta" />
      <Card withBorder padding="lg" w="100%" maw={420}>
        <Stack gap="sm">
          <TextInput label="Rol" value={tenantContext?.role ?? ''} readOnly />
          {tenantContext?.isPlatformAdmin ? (
            <form onSubmit={handleSubmit(values => updateProfile.mutate(values))}>
              <Stack gap="sm">
                <Controller
                  name="name"
                  control={control}
                  render={({ field, fieldState }) => (
                    <TextInput
                      {...field}
                      label="Nombre"
                      placeholder="Nombre y apellido"
                      required
                      error={fieldState.error?.message}
                      disabled={profile.isPending}
                    />
                  )}
                />
                <Text size="xs" c="dimmed">
                  Este nombre aparecerá en la actividad de las tareas.
                </Text>
                <Button type="submit" loading={updateProfile.isPending} disabled={profile.isPending}>
                  Guardar nombre
                </Button>
              </Stack>
            </form>
          ) : (
            <Text size="xs" c="dimmed">
              El nombre y el rol de la cuenta son de solo lectura.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  )
}
