'use client'

import { useRef, type ReactNode } from 'react'
import { Box, Button, Card, Flex, Group, Modal, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { ArrowRight } from 'lucide-react'
import { STATUS_TONE_COLOR } from '@/components/ui/StatusBadge'
import { ModalLayout } from '@/components/ui/ModalLayout'
import { TruncatedButton } from '@/components/ui/TruncatedButton'
import type { PortalMessageDTO } from '../service'
import {
  PORTAL_MESSAGE_TYPE_ICONS,
  PORTAL_MESSAGE_RECIPIENT_TYPE_LABELS,
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
          {PORTAL_MESSAGE_RECIPIENT_TYPE_LABELS[shown.message_type]}
          {hasQueue && ` · ${queuePosition} de ${queueTotal}`}
        </Text>
        {title}
      </Stack>
    </Group>
  )

  // data-autofocus: el modal enfoca la acción principal, no el primer botón que encuentre.
  const primary = (
    <TruncatedButton
      fullWidth
      data-autofocus
      onClick={onAction}
      loading={loadingPrimary}
      disabled={linkBlocked}
      rightSection={shown.entity ? <ArrowRight size={16} strokeWidth={1.5} /> : undefined}
    >
      {shown.cta_label?.trim() || 'Ver'}
    </TruncatedButton>
  )

  // Las acciones van en una fila, todas del mismo ancho, con la principal a la derecha. En
  // pantallas angostas se apilan con la principal arriba (column-reverse).
  const actions = (...buttons: ReactNode[]) => (
    <Flex direction={{ base: 'column-reverse', xs: 'row' }} gap="xs">
      {buttons.map((button, index) => (
        <Box key={index} style={{ flex: 1, minWidth: 0 }}>
          {button}
        </Box>
      ))}
    </Flex>
  )
  const footer = actionable
    ? revisit
      ? actions(
          <TruncatedButton fullWidth variant="default" onClick={onClose}>
            Cerrar
          </TruncatedButton>,
          primary
        )
      : actions(
          <TruncatedButton fullWidth variant="default" onClick={onNoThanks} loading={loadingNoThanks}>
            No gracias
          </TruncatedButton>,
          <TruncatedButton fullWidth variant="default" onClick={onRemindLater}>
            Recordarme más tarde
          </TruncatedButton>,
          primary
        )
    : actions(
        revisit ? (
          <TruncatedButton fullWidth variant="default" data-autofocus onClick={onClose}>
            Cerrar
          </TruncatedButton>
        ) : (
          <TruncatedButton fullWidth data-autofocus onClick={onAcknowledge}>
            Entendido
          </TruncatedButton>
        )
      )

  // En un accionable que sólo lleva a una sección, la tarjeta repetiría lo que ya dice el botón:
  // se muestra cuando aporta (una entidad concreta, o por qué el enlace no está disponible).
  // En un aviso es la única forma de navegar, así que siempre va, con su "Abrir".
  const showLink =
    shown.entity &&
    (!actionable || shown.entity.kind === 'entity' || shown.entity.access !== 'allowed')

  const body = (
    <Stack gap="md">
      <Text style={{ whiteSpace: 'pre-wrap' }}>{shown.description}</Text>
      {showLink && shown.entity && (
        <LinkedEntity
          entity={shown.entity}
          onOpen={actionable ? undefined : onAction}
          loading={loadingPrimary}
        />
      )}
    </Stack>
  )

  if (variant === 'inline') {
    return (
      <Card withBorder radius="lg" shadow="sm" w="100%" maw={620} mx="auto" p="lg">
        <Stack gap="md">
          {header(
            <Text component="h2" fw={700} fz="lg" lh={1.3}>
              {shown.title}
            </Text>
          )}
          {body}
          {footer}
        </Stack>
      </Card>
    )
  }

  // Compound modal on purpose: the header carries an icon and the queue label while the accessible
  // name stays the title alone (Modal's `title` renders an h2 that cannot hold that layout). The
  // theme already applies ModalLayout's content/header/body classes to these parts; never pass
  // them again here, because Modal.Content's className also lands on Mantine's outer `.inner` wrapper.
  return (
    <Modal.Root
      opened={opened && Boolean(message)}
      onClose={onClose}
      // Las tres acciones tienen que entrar del mismo ancho en una sola fila: con lg (620 px)
      // «Recordarme más tarde» se corta; 680 deja margen para fuentes del sistema más anchas.
      size={680}
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
          <ModalLayout footer={footer}>
            {/* Sólo se anima el cambio entre mensajes de la cola; la apertura ya la anima el modal. */}
            <div
              key={`${shown.id}:${queuePosition ?? 0}`}
              className={queuePosition && queuePosition > 1 ? styles.messageContent : undefined}
            >
              {body}
            </div>
          </ModalLayout>
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
