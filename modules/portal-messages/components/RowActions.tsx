'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { ActionIcon, Button, Group, Modal, Text, Tooltip } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Eye, Pencil, RotateCcw } from 'lucide-react'
import type { PortalMessageRecord } from '../service'
import { useReplayPortalMessage } from '../hooks/use-portal-messages'
import { portalMessageStatus } from '../portal-message-labels'

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
  const [confirming, confirm] = useDisclosure(false)
  const status = portalMessageStatus(message)
  const canReplay = status === 'active'

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
      <Tooltip label="Editar">
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`Editar ${message.title}`}
          onClick={() => onEdit(message)}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        label={
          canReplay
            ? 'Volver a mostrar a todos'
            : status === 'expired'
              ? 'Un mensaje vencido no se puede volver a mostrar'
              : 'Activa el mensaje para volver a mostrarlo'
        }
      >
        <ActionIcon
          variant="light"
          size="md"
          aria-label={`Volver a mostrar ${message.title} a todos`}
          // data-disabled en lugar de disabled: un botón deshabilitado no dispara el Tooltip
          // que explica por qué no está disponible.
          data-disabled={!canReplay || undefined}
          loading={replay.isPending}
          onClick={canReplay ? confirm.open : undefined}
        >
          <RotateCcw size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={confirming}
        onClose={confirm.close}
        title="Volver a mostrar el mensaje"
        centered
      >
        <ModalLayout
          gap="md"
          footer={
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={confirm.close}>
                Cancelar
              </Button>
              <Button
                leftSection={<RotateCcw size={16} strokeWidth={1.5} />}
                loading={replay.isPending}
                onClick={() => replay.mutate(message.id, { onSuccess: confirm.close })}
              >
                Volver a mostrar
              </Button>
            </Group>
          }
        >
          <Text size="sm">
            <strong>{message.title}</strong> volverá a aparecer como nuevo para todos sus
            destinatarios, incluso para quienes ya lo leyeron o descartaron.
          </Text>
        </ModalLayout>
      </Modal>
    </Group>
  )
}
