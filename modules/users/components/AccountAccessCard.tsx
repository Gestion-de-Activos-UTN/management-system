import type { ReactNode } from 'react'
import {
  Card,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core'
import { Building2, MapPin, ShieldCheck } from 'lucide-react'
import type { MyProfile } from '@/endpoints/myProfile'
import { roleSlugLabel } from '@/lib/role-labels'
import { ROLE_DESCRIPTIONS } from '../member-labels'

function AccessRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
        {icon}
      </ThemeIcon>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        {children}
      </div>
    </Group>
  )
}

type Access = Pick<MyProfile, 'role'> &
  Partial<Pick<MyProfile, 'organization' | 'all_offices' | 'offices'>>

/**
 * Rol y, para una persona de una organización, organización y oficinas. Solo lectura: lo cambia
 * un administrador. El admin de plataforma sólo tiene rol.
 */
export function AccountAccessCard({ profile }: { profile?: Access }) {
  if (!profile) {
    return (
      <Card withBorder radius="lg" p="lg">
        <Skeleton height={180} />
      </Card>
    )
  }
  const description = profile.role
    ? ROLE_DESCRIPTIONS[profile.role as keyof typeof ROLE_DESCRIPTIONS]
    : undefined
  const inOrganization = profile.organization !== undefined
  const offices = profile.offices ?? []
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <div>
          <Text fw={700}>Mi acceso</Text>
          <Text size="xs" c="dimmed">
            {inOrganization
              ? 'Lo define un administrador de tu organización.'
              : 'Acceso de plataforma, no pertenece a ninguna organización.'}
          </Text>
        </div>
        {inOrganization && (
          <>
            <AccessRow icon={<Building2 size={18} strokeWidth={1.5} />} label="Organización">
              <Text fw={600}>{profile.organization?.name ?? '—'}</Text>
            </AccessRow>
            <Divider />
          </>
        )}
        <AccessRow icon={<ShieldCheck size={18} strokeWidth={1.5} />} label="Rol">
          <Text fw={600}>{profile.role ? roleSlugLabel(profile.role) : '—'}</Text>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </AccessRow>
        {inOrganization && (
          <>
            <Divider />
            <AccessRow icon={<MapPin size={18} strokeWidth={1.5} />} label="Oficinas">
              <Text fw={600} mb={offices.length ? 'xs' : 0}>
                {profile.all_offices
                  ? `Todas las oficinas (${offices.length})`
                  : offices.length === 1
                    ? '1 oficina'
                    : `${offices.length} oficinas`}
              </Text>
              <ScrollArea.Autosize mah={240} type="auto" offsetScrollbars>
                <Stack gap={6}>
                  {offices.map(office => (
                    <Paper key={office.id} withBorder radius="md" px="sm" py={6}>
                      <Text size="sm" fw={500}>
                        {office.name}
                      </Text>
                      {office.location && (
                        <Text size="xs" c="dimmed">
                          {office.location}
                        </Text>
                      )}
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </AccessRow>
          </>
        )}
      </Stack>
    </Card>
  )
}
