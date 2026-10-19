'use client'

import Link from 'next/link'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { ExternalLink, Power, PowerOff } from 'lucide-react'
import type { Organization } from '@/app/types/payload-types'

export function RowActions({
  organization,
  onToggleActive,
}: {
  organization: Organization
  onToggleActive: (organization: Organization) => void
}) {
  const active = organization.is_active !== false
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Visitar">
        <ActionIcon
          component={Link}
          href={`/portal/dashboard?asOrganization=${organization.id}`}
          variant="light"
          size="md"
          aria-label={`Visitar ${organization.name}`}
        >
          <ExternalLink size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={active ? 'Desactivar' : 'Reactivar'}>
        <ActionIcon
          variant="light"
          size="md"
          color={active ? 'red' : undefined}
          aria-label={`${active ? 'Desactivar' : 'Reactivar'} ${organization.name}`}
          onClick={() => onToggleActive(organization)}
        >
          {active ? (
            <PowerOff size={16} strokeWidth={1.5} />
          ) : (
            <Power size={16} strokeWidth={1.5} />
          )}
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
