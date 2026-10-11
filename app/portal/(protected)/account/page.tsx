'use client'

import Link from 'next/link'
import { Alert, Anchor, SimpleGrid, Stack } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useSession } from '@/lib/use-session'
import { useMyProfile, useUpdateMyProfile } from '@/modules/users/hooks/use-org-members'
import { AccountProfileCard } from '@/modules/users/components/AccountProfileCard'
import { AccountAccessCard } from '@/modules/users/components/AccountAccessCard'

export default function AccountPage() {
  const session = useSession()
  // Un admin de plataforma "visitando" una organización no tiene perfil de organización.
  const isPlatformAdmin = session?.collection === 'admins'
  const profile = useMyProfile(session?.collection === 'users')
  const save = useUpdateMyProfile()

  return (
    <Stack gap="lg">
      <PageHeader title="Configuración de la cuenta" description="Tu perfil y tu acceso." />
      {isPlatformAdmin ? (
        <Alert color="blue">
          Estás viendo esta organización como administrador de plataforma. Tu perfil se edita en{' '}
          <Anchor component={Link} href="/account" inherit>
            la configuración de tu cuenta de plataforma
          </Anchor>
          .
        </Alert>
      ) : profile.isError ? (
        <Alert color="red">No se pudo cargar tu perfil.</Alert>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <AccountProfileCard
            profile={profile.data}
            onSave={name => save.mutate(name)}
            saving={save.isPending}
          />
          <AccountAccessCard profile={profile.data} />
        </SimpleGrid>
      )}
    </Stack>
  )
}
