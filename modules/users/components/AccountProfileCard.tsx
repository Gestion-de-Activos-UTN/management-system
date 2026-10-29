'use client'

import { textRuleError } from '@/lib/text-rules'
import { useState } from 'react'
import { Avatar, Button, Card, Group, Skeleton, Stack, Text, TextInput } from '@mantine/core'
import { Save } from 'lucide-react'
import { ProfileUpdateSchema } from '../schema'

type Profile = { name: string; email: string }
type Props = {
  profile?: Profile
  onSave: (name: string) => void
  saving: boolean
  /** Dónde se ve el nombre, para la ayuda del campo. */
  nameHint?: string
}

function initials(name: string, email: string) {
  const words = (name || email).trim().split(/\s+/)
  return words
    .slice(0, 2)
    .map(word => word[0]?.toLocaleUpperCase('es') ?? '')
    .join('')
}

/** Perfil propio (portal y panel de plataforma): nombre editable, email de solo lectura. */
export function AccountProfileCard({ profile, ...props }: Props) {
  return (
    <Card withBorder radius="lg" p="lg">
      {profile ? (
        <ProfileForm key={profile.name} profile={profile} {...props} />
      ) : (
        <Skeleton height={180} />
      )}
    </Card>
  )
}

function ProfileForm({
  profile,
  onSave,
  saving,
  nameHint = 'Así te ven las demás personas de tu organización.',
}: Props & { profile: Profile }) {
  const [name, setName] = useState(profile.name)
  const [error, setError] = useState('')
  const changed = name.trim() !== profile.name

  const submit = () => {
    const parsed = ProfileUpdateSchema.safeParse({ name })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Nombre inválido.')
    setError('')
    onSave(parsed.data.name)
  }

  return (
    <Stack gap="lg">
      <Group gap="md" wrap="nowrap">
        <Avatar radius="xl" size={56} color="pine">
          {initials(profile.name, profile.email)}
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="lg" truncate>
            {profile.name || profile.email}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {profile.email}
          </Text>
        </div>
      </Group>
      <form
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
      >
        <Stack gap="sm">
          <TextInput
            label="Nombre"
            description={nameHint}
            maxLength={120}
            value={name}
            error={error || textRuleError(name, 'personName')}
            onChange={event => {
              const value = event.currentTarget.value
              setName(value)
              const parsed = ProfileUpdateSchema.safeParse({ name: value })
              setError(
                parsed.success ? '' : (parsed.error.issues[0]?.message ?? 'Nombre inválido.')
              )
            }}
          />
          <div>
            <Text size="sm" fw={500}>
              Correo electrónico
            </Text>
            <Text size="sm">{profile.email}</Text>
            <Text size="xs" c="dimmed">
              Lo administra tu proveedor de acceso; no se cambia desde acá.
            </Text>
          </div>
          <Group justify="flex-end">
            <Button
              type="submit"
              disabled={!changed}
              loading={saving}
              leftSection={<Save size={16} strokeWidth={1.5} />}
            >
              Guardar
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  )
}
