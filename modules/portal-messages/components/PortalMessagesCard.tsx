'use client'

import { useState } from 'react'
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { BellRing } from 'lucide-react'
import { usePortalMessageReceipt, usePortalMessages } from '../hooks/use-portal-messages'
import { usePortalMessageActions } from '../hooks/use-portal-message-actions'
import type { PortalMessageDTO } from '../service'
import { PortalMessageDialog } from './PortalMessageDialog'
import { markPortalMessageShown } from '../session-state'

export function PortalMessagesCard() {
  const query = usePortalMessages()
  const receipt = usePortalMessageReceipt()
  const [active, setActive] = useState<PortalMessageDTO | null>(null)
  const messages = query.data ?? []
  const actions = usePortalMessageActions(active, () => setActive(null))

  const open = (message: PortalMessageDTO) => {
    markPortalMessageShown(message.id, message.delivery_version)
    setActive(message)
    if (!message.seen)
      receipt.mutate({
        id: message.id,
        status: 'seen',
        deliveryVersion: message.delivery_version,
      })
  }
  return (
    <>
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <BellRing size={18} />
              <Title order={3} size="h5">
                Mensajes
              </Title>
            </Group>
            <Text size="sm" c="dimmed">
              {messages.length}
            </Text>
          </Group>
          {query.isPending ? (
            <Text size="sm" c="dimmed">
              Cargando mensajes…
            </Text>
          ) : messages.length ? (
            messages.slice(0, 5).map(message => (
              <Group
                key={message.id}
                justify="space-between"
                wrap="nowrap"
                opacity={message.dismissed ? 0.65 : 1}
              >
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text fw={message.seen ? 400 : 700} size="sm" lineClamp={1}>
                      {message.title}
                    </Text>
                    <Badge
                      size="xs"
                      variant={message.seen ? 'light' : 'filled'}
                      color={message.seen ? 'gray' : 'blue'}
                    >
                      {message.seen ? 'Leído' : 'Nuevo'}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {message.dismissed
                      ? 'Descartado'
                      : message.message_type === 'actionable'
                        ? 'Acción requerida'
                        : 'Aviso'}
                  </Text>
                </Stack>
                <Button size="xs" variant="light" onClick={() => open(message)}>
                  Ver
                </Button>
              </Group>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              No tienes mensajes.
            </Text>
          )}
        </Stack>
      </Card>
      <PortalMessageDialog
        message={active}
        opened={Boolean(active)}
        onClose={() => void actions.noThanks()}
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
