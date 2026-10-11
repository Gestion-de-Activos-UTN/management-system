'use client'

import { Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core'
import type { PortalMessageDTO } from '../service'
import styles from './PortalMessageDialog.module.css'

export function PortalMessageDialog({
  message,
  opened,
  onClose,
  onAcknowledge,
  onRemindLater,
  onNoThanks,
  onAction,
  loadingNoThanks = false,
  loadingPrimary = false,
  queuePosition,
  queueTotal,
  variant = 'dialog',
  readOnly = false,
}: {
  message: Pick<
    PortalMessageDTO,
    'id' | 'title' | 'description' | 'message_type' | 'cta_label' | 'entity'
  > | null
  opened: boolean
  onClose: () => void
  onAcknowledge?: () => void
  onRemindLater?: () => void
  onNoThanks?: () => void
  onAction?: () => void
  loadingNoThanks?: boolean
  loadingPrimary?: boolean
  queuePosition?: number
  queueTotal?: number
  variant?: 'dialog' | 'inline'
  readOnly?: boolean
}) {
  if (!message) return null
  const hasQueue = Boolean(queueTotal && queueTotal > 1 && queuePosition)
  const unavailable = message.entity && message.entity.access !== 'allowed'

  const content = (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Title order={2} size="h3">
          {message.title || 'Mensaje sin título'}
        </Title>
        {hasQueue && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {queuePosition} de {queueTotal}
          </Text>
        )}
      </Group>
      <Text style={{ whiteSpace: 'pre-wrap' }}>{message.description || 'Sin descripción.'}</Text>
      {message.entity?.label && (
        <Text size="sm" c="dimmed">
          Relacionado con: <strong>{message.entity.label}</strong>
        </Text>
      )}
      {!message.entity?.label && unavailable && (
        <Text size="sm" c="dimmed" fs="italic">
          No tienes acceso a la entidad enlazada.
        </Text>
      )}
      <Group justify="flex-end" mt="sm">
        {readOnly ? (
          <Button onClick={onClose}>Cerrar</Button>
        ) : message.message_type === 'notice' ? (
          <Button onClick={onAcknowledge}>Entendido</Button>
        ) : (
          <>
            <Button variant="default" onClick={onRemindLater}>
              Recordarme más tarde
            </Button>
            <Button variant="default" onClick={onNoThanks} loading={loadingNoThanks}>
              No gracias
            </Button>
            <Button onClick={onAction} loading={loadingPrimary}>
              {message.cta_label?.trim() || 'Ver'}
            </Button>
          </>
        )}
      </Group>
    </Stack>
  )

  if (variant === 'inline') {
    return (
      <Card withBorder radius="md" shadow="sm" w="100%" maw={480} mx="auto" p="lg">
        {content}
      </Card>
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title={null}
      withCloseButton
      transitionProps={{
        transition: 'pop',
        duration: 380,
        timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      <div key={`${message.id}:${queuePosition ?? 0}`} className={styles.messageContent}>
        {content}
      </div>
    </Modal>
  )
}
