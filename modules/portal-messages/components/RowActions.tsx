'use client'

import { ActionIcon, Group, Menu, Tooltip } from '@mantine/core'
import { Ellipsis, Eye, Pencil, RotateCcw } from 'lucide-react'
import type { PortalMessageRecord } from '../service'
import { useReplayPortalMessage } from '../hooks/use-portal-messages'

export function RowActions({
  message,
  onPreview,
  onEdit,
}: {
  message: PortalMessageRecord
  onPreview: (message: PortalMessageRecord) => void
  onEdit: (message: PortalMessageRecord) => void
}) {
  const replay = useReplayPortalMessage()
  const expired = Boolean(
    message.expires_at && new Date(message.expires_at).getTime() <= Date.now()
  )
  const canReplay = Boolean(message.is_active) && !expired

  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Vista previa">
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`Vista previa de ${message.title}`}
          onClick={() => onPreview(message)}
        >
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="md" aria-label="Más acciones">
            <Ellipsis size={16} strokeWidth={1.5} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<Pencil size={14} strokeWidth={1.5} />}
            onClick={() => onEdit(message)}
          >
            Editar mensaje
          </Menu.Item>
          <Menu.Item
            leftSection={<RotateCcw size={14} strokeWidth={1.5} />}
            disabled={!canReplay || replay.isPending}
            onClick={() => replay.mutate(message.id)}
          >
            Volver a mostrar a todos
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
