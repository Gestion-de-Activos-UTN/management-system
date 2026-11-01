'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { Button, Group, Modal, Text } from '@mantine/core'
import { Trash2 } from 'lucide-react'

export function TaskDeleteModal({
  opened,
  title,
  isPending,
  onClose,
  onConfirm,
}: {
  opened: boolean
  title: string
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      opened={opened}
      onClose={() => !isPending && onClose()}
      title="Eliminar tarea"
      centered
      closeOnClickOutside={!isPending}
      closeOnEscape={!isPending}
      withCloseButton={!isPending}
    >
      <ModalLayout
        gap="md"
        footer={
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose} disabled={isPending} data-autofocus>
              Cancelar
            </Button>
            <Button
              color="red"
              leftSection={<Trash2 size={16} strokeWidth={1.5} />}
              loading={isPending}
              onClick={() => !isPending && onConfirm()}
            >
              Eliminar tarea
            </Button>
          </Group>
        }
      >
        <Text size="sm">
          ¿Quieres eliminar la tarea <strong>{title}</strong>?
        </Text>
        <Text size="sm" c="dimmed">
          No se puede deshacer ni queda registro. Úsalo solo para una tarea creada por error; si ya
          no hace falta, cancélala: queda registrada con su motivo.
        </Text>
      </ModalLayout>
    </Modal>
  )
}
