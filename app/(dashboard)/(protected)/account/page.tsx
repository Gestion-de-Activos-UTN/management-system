'use client'

import { Alert, SimpleGrid, Stack } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import {
  usePlatformAdminProfile,
  useUpdatePlatformAdminProfile,
} from '@/modules/auth/hooks/use-platform-admin-profile'
import { AccountProfileCard } from '@/modules/users/components/AccountProfileCard'
import { AccountAccessCard } from '@/modules/users/components/AccountAccessCard'

// Cuenta del admin de plataforma: mismo diseño que la del portal (perfil + acceso), sin
// organización ni oficinas.
export default function AccountPage() {
  const profile = usePlatformAdminProfile()
  const updateProfile = useUpdatePlatformAdminProfile()

  return (
    <Stack gap="lg">
      <PageHeader title="Configuración de la cuenta" description="Tu perfil y tu acceso." />
      {profile.isError ? (
        <Alert color="red">No se pudo cargar tu perfil.</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <AccountProfileCard
            profile={profile.data}
            onSave={name => updateProfile.mutate({ name })}
            saving={updateProfile.isPending}
            nameHint="Este nombre aparece en la actividad de las tareas."
          />
          <AccountAccessCard profile={profile.data && { role: 'platform_admin' }} />
        </SimpleGrid>
      )}
    </Stack>
  )
}
