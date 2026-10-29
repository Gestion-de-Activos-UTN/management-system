'use client'

import { Button, Group, Modal, Stack, Text } from '@mantine/core'
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
      <Stack gap="md">
        <Text size="sm">
          ¿Quieres eliminar la tarea <strong>{title}</strong>?
        </Text>
        <Text size="sm" c="dimmed">
          Esta acción no se puede deshacer.
        </Text>
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
      </Stack>
    </Modal>
  )
}
