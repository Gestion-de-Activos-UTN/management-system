'use client'

import Link from 'next/link'
import { ActionIcon, Group, Menu, Tooltip } from '@mantine/core'
import { Ellipsis, ExternalLink, Pencil, Power, PowerOff, UserPlus } from 'lucide-react'
import type { Organization } from '@/app/types/payload-types'

export function RowActions({
  organization,
  onToggleActive,
  onAddOrgAdmin,
  onEdit,
}: {
  organization: Organization
  onToggleActive: (organization: Organization) => void
  onAddOrgAdmin: (organization: Organization) => void
  onEdit: (organization: Organization) => void
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
        <Tooltip label="Editar organización">
          <ActionIcon
            variant="light"
            size="md"
            aria-label={`Editar organización ${organization.name}`}
            onClick={() => onEdit(organization)}
          >
            <Pencil size={16} strokeWidth={1.5} />
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
      {active && (
        <Menu withinPortal position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              aria-label={`Más acciones de ${organization.name}`}
            >
              <Ellipsis size={16} strokeWidth={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<UserPlus size={14} strokeWidth={1.5} />}
              onClick={() => onAddOrgAdmin(organization)}
            >
              Añadir OrgAdmin
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  )
}
