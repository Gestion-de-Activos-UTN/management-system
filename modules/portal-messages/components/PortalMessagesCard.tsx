'use client'

import { useState } from 'react'
import { Anchor, Card, Group, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatRelativeDays } from '@/lib/format-date'
import { usePortalMessageReceipt, usePortalMessages } from '../hooks/use-portal-messages'
import { usePortalMessageActions } from '../hooks/use-portal-message-actions'
import type { PortalMessageDTO } from '../service'
import { PORTAL_MESSAGE_HISTORY_DAYS, isInPortalMessageHistory } from '../portal-message-labels'
import { PortalMessageDialog } from './PortalMessageDialog'
import { markPortalMessageShown } from '../session-state'

const VISIBLE = 5

/**
 * Mensajes vigentes del usuario: sin leer primero; los leídos hasta cumplir 30 días.
 * `embedded`: sin tarjeta ni título (va dentro de tabs).
 */
export function PortalMessagesCard({ embedded = false }: { embedded?: boolean }) {
  const query = usePortalMessages()
  const receipt = usePortalMessageReceipt()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
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

  const header = (unread > 0 || messages.length > VISIBLE || !embedded) && (
    <Group justify="space-between">
      <Group gap="xs">
        {!embedded && <Text fw={700}>Mensajes</Text>}
        {unread > 0 && <StatusBadge tone="info" label={`${unread} sin leer`} />}
      </Group>
      {messages.length > VISIBLE && (
        <Anchor component="button" size="sm" onClick={() => setShowAll(value => !value)}>
          {showAll ? 'Ver menos' : `Ver todos (${messages.length})`}
        </Anchor>
      )}
    </Group>
  )
  const content = (
    <Stack gap="md">
      {header}
      {query.isPending ? (
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
          {(showAll ? messages : messages.slice(0, VISIBLE)).map(message => (
            <UnstyledButton
              key={message.id}
              onClick={() => open(message)}
              aria-label={`Abrir mensaje: ${message.title}`}
            >
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={message.seen ? 400 : 600} lineClamp={1}>
                    {message.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {message.dismissed
                      ? 'Ya respondido'
                      : message.message_type === 'actionable'
                        ? 'Acción requerida'
                        : 'Aviso'}
                    {message.createdAt && ` · ${formatRelativeDays(message.createdAt)}`}
                  </Text>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <StatusBadge
                    tone={message.seen ? 'neutral' : 'info'}
                    label={message.seen ? 'Leído' : 'Nuevo'}
                  />
                </div>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Stack>
  )

  return (
    <>
      {embedded ? (
        content
      ) : (
        <Card withBorder radius="lg" p="lg">
          {content}
        </Card>
      )}
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
