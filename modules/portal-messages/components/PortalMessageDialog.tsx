'use client'

import { useRef, type ReactNode } from 'react'
import { Button, Card, Group, Modal, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { ArrowRight } from 'lucide-react'
import { STATUS_TONE_COLOR } from '@/components/ui/StatusBadge'
import type { PortalMessageDTO } from '../service'
import {
  PORTAL_MESSAGE_TYPE_ICONS,
  PORTAL_MESSAGE_TYPE_LABELS,
  PORTAL_MESSAGE_TYPE_TONES,
  portalMessageLinkType,
} from '../portal-message-labels'
import styles from './PortalMessageDialog.module.css'

type DialogMessage = Pick<
  PortalMessageDTO,
  'id' | 'title' | 'description' | 'message_type' | 'cta_label' | 'entity'
> & { dismissed?: boolean }

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
}: {
  message: DialogMessage | null
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
}) {
  // Se conserva el último mensaje para que el modal haga su transición de salida en lugar de
  // desmontarse de golpe cuando la cola termina.
  const lastMessage = useRef(message)
  if (message) lastMessage.current = message
  const shown = message ?? lastMessage.current
  if (!shown) return null

  const actionable = shown.message_type === 'actionable'
  const revisit = Boolean(shown.dismissed)
  const linkBlocked = Boolean(shown.entity && shown.entity.access !== 'allowed')
  const hasQueue = Boolean(queueTotal && queueTotal > 1 && queuePosition)
  const TypeIcon = PORTAL_MESSAGE_TYPE_ICONS[shown.message_type]

  const header = (title: ReactNode) => (
    <Group gap="sm" wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
      <ThemeIcon
        variant="light"
        size="lg"
        radius="md"
        color={STATUS_TONE_COLOR[PORTAL_MESSAGE_TYPE_TONES[shown.message_type]]}
        aria-hidden
      >
        <TypeIcon size={18} strokeWidth={1.5} />
      </ThemeIcon>
      <Stack gap={2} miw={0}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {PORTAL_MESSAGE_TYPE_LABELS[shown.message_type]}
          {hasQueue && ` · ${queuePosition} de ${queueTotal}`}
        </Text>
        {title}
      </Stack>
    </Group>
  )

  const primary = (
    <Button
      onClick={onAction}
      loading={loadingPrimary}
      disabled={linkBlocked}
      rightSection={shown.entity ? <ArrowRight size={16} strokeWidth={1.5} /> : undefined}
    >
      {shown.cta_label?.trim() || 'Ver'}
    </Button>
  )

  const footer = actionable ? (
    revisit ? (
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Cerrar
        </Button>
        {primary}
      </Group>
    ) : (
      <Group justify="space-between" gap="xs">
        <Button variant="subtle" color="gray" onClick={onNoThanks} loading={loadingNoThanks}>
          No gracias
        </Button>
        <Group gap="xs" ml="auto">
          <Button variant="default" onClick={onRemindLater}>
            Recordarme más tarde
          </Button>
          {primary}
        </Group>
      </Group>
    )
  ) : (
    <Group justify="flex-end">
      {revisit ? (
        <Button variant="default" onClick={onClose}>
          Cerrar
        </Button>
      ) : (
        <Button onClick={onAcknowledge}>Entendido</Button>
      )}
    </Group>
  )

  const body = (
    <Stack gap="md">
      <Text style={{ whiteSpace: 'pre-wrap' }}>{shown.description}</Text>
      {shown.entity && (
        <LinkedEntity
          entity={shown.entity}
          // En un aviso el enlace es la única forma de navegar; en uno accionable lo hace la acción.
          onOpen={actionable ? undefined : onAction}
          loading={loadingPrimary}
        />
      )}
      <div style={{ marginTop: 'var(--mantine-spacing-xs)' }}>{footer}</div>
    </Stack>
  )

  if (variant === 'inline') {
    return (
      <Card withBorder radius="lg" shadow="sm" w="100%" maw={480} mx="auto" p="lg">
        <Stack gap="md">
          {header(
            <Text component="h2" fw={700} fz="lg" lh={1.3}>
              {shown.title}
            </Text>
          )}
          {body}
        </Stack>
      </Card>
    )
  }

  return (
    <Modal.Root
      opened={opened && Boolean(message)}
      onClose={onClose}
      centered
      transitionProps={{
        transition: 'pop',
        duration: 280,
        timingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      <Modal.Overlay />
      <Modal.Content radius="lg">
        <Modal.Header style={{ alignItems: 'flex-start' }}>
          {header(
            <Modal.Title fw={700} fz="lg" lh={1.3}>
              {shown.title}
            </Modal.Title>
          )}
          <Modal.CloseButton aria-label="Cerrar mensaje" />
        </Modal.Header>
        <Modal.Body>
          {/* Sólo se anima el cambio entre mensajes de la cola; la apertura ya la anima el modal. */}
          <div
            key={`${shown.id}:${queuePosition ?? 0}`}
            className={queuePosition && queuePosition > 1 ? styles.messageContent : undefined}
          >
            {body}
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  )
}

function LinkedEntity({
  entity,
  onOpen,
  loading,
}: {
  entity: NonNullable<PortalMessageDTO['entity']>
  onOpen?: () => void
  loading: boolean
}) {
  const type = portalMessageLinkType(entity)
  const Icon = type.icon
  const allowed = entity.access === 'allowed'
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
            <Icon size={18} strokeWidth={1.5} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {type.label}
            </Text>
            <Text fw={600} size="sm" lineClamp={2} c={allowed ? undefined : 'dimmed'}>
              {allowed
                ? entity.label
                : entity.access === 'denied'
                  ? 'No tienes acceso a este elemento'
                  : 'Este elemento ya no está disponible'}
            </Text>
          </div>
        </Group>
        {onOpen && allowed && (
          <Button
            variant="light"
            size="xs"
            onClick={onOpen}
            loading={loading}
            rightSection={<ArrowRight size={14} strokeWidth={1.5} />}
            style={{ flexShrink: 0 }}
          >
            Abrir
          </Button>
        )}
      </Group>
    </Paper>
  )
}
