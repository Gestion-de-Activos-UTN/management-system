'use client'

import { useState } from 'react'
import { Box, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core'
import { useSession } from '@/lib/use-session'
import { formatRelativeDays } from '@/lib/format-date'
import { usePortalMessageReceipt, usePortalMessages } from '../hooks/use-portal-messages'
import { usePortalMessageActions } from '../hooks/use-portal-message-actions'
import type { PortalMessageDTO } from '../service'
import {
  PORTAL_MESSAGE_HISTORY_DAYS,
  PORTAL_MESSAGE_RECIPIENT_TYPE_LABELS,
  isInPortalMessageHistory,
} from '../portal-message-labels'
import { PortalMessageDialog } from './PortalMessageDialog'
import { markPortalMessageShown } from '../session-state'
import classes from './PortalMessagesList.module.css'

/** Mensajes vigentes del usuario: sin leer primero; los leídos hasta cumplir 30 días. */
export function PortalMessagesList() {
  const session = useSession()
  // La bandeja es personal: /v1/portal-messages responde 403 a un admin de plataforma
  // que visita la organización, así que ni se consulta.
  const isMember = session?.collection === 'users'
  const query = usePortalMessages(isMember)
  const receipt = usePortalMessageReceipt()
  const [activeId, setActiveId] = useState<string | null>(null)
  const messages = (query.data ?? [])
    .filter(message => isInPortalMessageHistory(message))
    .sort((a, b) => Number(a.seen) - Number(b.seen) || Number(a.dismissed) - Number(b.dismissed))
  // Se lee de la query para que el diálogo refleje el recibo recién guardado.
  const active = messages.find(message => message.id === activeId) ?? null
  const actions = usePortalMessageActions(active, () => setActiveId(null))
  const unread = messages.filter(message => !message.seen).length

  const open = (message: PortalMessageDTO) => {
    markPortalMessageShown(message.id, message.delivery_version)
    setActiveId(message.id)
    if (!message.seen)
      receipt.mutate({
        id: message.id,
        status: 'seen',
        deliveryVersion: message.delivery_version,
      })
  }

  const content = (
    <Stack gap="md">
      {unread > 0 && (
        <Text size="xs" c="dimmed" ta="right" aria-live="polite">
          {unread} sin leer
        </Text>
      )}
      {session && !isMember ? (
        <Text size="sm" c="dimmed" py="md">
          La bandeja de mensajes es personal de cada miembro de la organización.
        </Text>
      ) : query.isPending ? (
        <Stack gap="sm">
          <Skeleton height={40} />
          <Skeleton height={40} />
        </Stack>
      ) : query.isError ? (
        <Text size="sm" c="red" py="md">
          No se pudieron cargar los mensajes.
        </Text>
      ) : messages.length === 0 ? (
        <Text size="sm" c="dimmed" py="md">
          No tienes mensajes. Los leídos se muestran hasta {PORTAL_MESSAGE_HISTORY_DAYS} días
          después de publicados.
        </Text>
      ) : (
        <Stack gap="xs">
          {messages.map(message => (
            <UnstyledButton
              key={message.id}
              onClick={() => open(message)}
              className={classes.readerItem}
              aria-label={`Abrir mensaje: ${message.title} (${message.seen ? 'leído' : 'sin leer'})`}
            >
              <Box
                component="span"
                className={classes.unreadDot}
                data-read={message.seen || undefined}
                aria-hidden="true"
              />
              <div className={classes.readerContent}>
                <Text size="sm" fw={message.seen ? 400 : 600} style={{ overflowWrap: 'anywhere' }}>
                  {message.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {message.dismissed
                    ? 'Ya respondido'
                    : PORTAL_MESSAGE_RECIPIENT_TYPE_LABELS[message.message_type]}
                  {message.createdAt && ` · ${formatRelativeDays(message.createdAt)}`}
                </Text>
              </div>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Stack>
  )

  return (
    <>
      {content}
      <PortalMessageDialog
        message={active}
        opened={Boolean(active)}
        onClose={actions.close}
        onAcknowledge={() => void actions.acknowledge()}
        onRemindLater={actions.remindLater}
        onNoThanks={() => void actions.noThanks()}
        onAction={() => void actions.primaryAction()}
        loadingNoThanks={actions.busy === 'no_thanks'}
        loadingPrimary={actions.busy === 'primary'}
      />
    </>
  )
}
