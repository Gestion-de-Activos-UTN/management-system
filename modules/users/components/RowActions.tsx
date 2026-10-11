'use client'

import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { Pencil, UserCheck, UserX } from 'lucide-react'
import type { OrgMember } from '../service'

export function RowActions({
  member,
  isSelf,
  onEditAccess,
  onToggleActive,
}: {
  member: OrgMember
  isSelf: boolean
  onEditAccess: (member: OrgMember) => void
  onToggleActive: (member: OrgMember) => void
}) {
  const name = member.name || member.email
  const blockSelf = isSelf && member.is_active
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip
        label={
          member.is_active ? 'Editar rol y oficinas' : 'Reactiva a la persona para editar su acceso'
        }
      >
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`Editar acceso de ${name}`}
          // data-disabled: un botón deshabilitado no dispara el Tooltip que explica por qué.
          data-disabled={!member.is_active || undefined}
          onClick={member.is_active ? () => onEditAccess(member) : undefined}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        label={
          blockSelf
            ? 'No puedes desactivarte a ti mismo'
            : member.is_active
              ? 'Desactivar'
              : 'Reactivar'
        }
      >
        <ActionIcon
          variant="light"
          size="md"
          color={member.is_active ? 'red' : undefined}
          aria-label={`${member.is_active ? 'Desactivar' : 'Reactivar'} a ${name}`}
          data-disabled={blockSelf || undefined}
          onClick={blockSelf ? undefined : () => onToggleActive(member)}
        >
          {member.is_active ? (
            <UserX size={16} strokeWidth={1.5} />
          ) : (
            <UserCheck size={16} strokeWidth={1.5} />
          )}
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
