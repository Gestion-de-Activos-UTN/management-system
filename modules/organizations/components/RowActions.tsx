'use client'

import Link from 'next/link'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { ExternalLink, Power, PowerOff, UserPlus } from 'lucide-react'
import type { Organization } from '@/app/types/payload-types'

export function RowActions({
  organization,
  onToggleActive,
  onAddOrgAdmin,
}: {
  organization: Organization
  onToggleActive: (organization: Organization) => void
  onAddOrgAdmin: (organization: Organization) => void
}) {
  const active = organization.is_active !== false
  const statusAction = active ? 'Desactivar organización' : 'Reactivar organización'
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Abrir portal de la organización">
        <ActionIcon
          component={Link}
          href={`/portal/dashboard?asOrganization=${organization.id}`}
          variant="light"
          size="md"
          aria-label={`Abrir el portal de la organización ${organization.name}`}
        >
          <ExternalLink size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      {active && (
        <Tooltip label="Añadir OrgAdmin">
          <ActionIcon
            variant="light"
            size="md"
            aria-label={`Añadir OrgAdmin a ${organization.name}`}
            onClick={() => onAddOrgAdmin(organization)}
          >
            <UserPlus size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label={statusAction}>
        <ActionIcon
          variant="light"
          size="md"
          color={active ? 'red' : undefined}
          aria-label={`${statusAction} ${organization.name}`}
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
